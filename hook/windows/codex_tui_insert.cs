using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

internal static class CodexTuiInsert
{
    private const ushort KeyEvent = 0x0001;
    private const uint ToolhelpSnapshotProcess = 0x00000002;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ExeFile;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct KeyEventRecord
    {
        [MarshalAs(UnmanagedType.Bool)] public bool KeyDown;
        public ushort RepeatCount;
        public ushort VirtualKeyCode;
        public ushort VirtualScanCode;
        public char UnicodeChar;
        public uint ControlKeyState;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    private struct InputRecord
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KeyEventRecord KeyEvent;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string fileName, uint desiredAccess, uint shareMode,
        IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry32 entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry32 entry);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WriteConsoleInputW(IntPtr input, InputRecord[] buffer, uint length, out uint written);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);

    private static uint FindAncestorCodexProcess()
    {
        var parents = new Dictionary<uint, uint>();
        var names = new Dictionary<uint, string>();
        IntPtr snapshot = CreateToolhelp32Snapshot(ToolhelpSnapshotProcess, 0);
        if (snapshot == InvalidHandleValue) throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var entry = new ProcessEntry32 { Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32)) };
            if (Process32FirstW(snapshot, ref entry))
            {
                do
                {
                    parents[entry.ProcessId] = entry.ParentProcessId;
                    names[entry.ProcessId] = entry.ExeFile ?? string.Empty;
                    entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
                }
                while (Process32NextW(snapshot, ref entry));
            }
        }
        finally { CloseHandle(snapshot); }

        uint current = GetCurrentProcessId();
        for (int depth = 0; depth < 32; depth++)
        {
            uint parent;
            if (!parents.TryGetValue(current, out parent) || parent == 0 || parent == current) break;
            string name;
            if (names.TryGetValue(parent, out name) &&
                string.Equals(name, "codex.exe", StringComparison.OrdinalIgnoreCase)) return parent;
            current = parent;
        }
        return 0;
    }

    private static InputRecord Key(char value, bool down)
    {
        return new InputRecord
        {
            EventType = KeyEvent,
            KeyEvent = new KeyEventRecord
            {
                KeyDown = down,
                RepeatCount = 1,
                VirtualKeyCode = 0,
                VirtualScanCode = 0,
                UnicodeChar = value,
                ControlKeyState = 0,
            },
        };
    }

    private static int Main(string[] args)
    {
        string title = string.Join(" ", args).Trim().Replace("\"", string.Empty);
        if (title.Length == 0 || title.IndexOfAny(new[] { '\r', '\n', '\0' }) >= 0)
        {
            Console.Error.WriteLine("A non-empty single-line title is required.");
            return 2;
        }
        string command = "/rename \"" + title + "\"";
        var records = new List<InputRecord>(command.Length * 2);
        foreach (char value in command)
        {
            records.Add(Key(value, true));
            records.Add(Key(value, false));
        }

        uint target = FindAncestorCodexProcess();
        if (target == 0)
        {
            Console.Error.WriteLine("No ancestor codex.exe process was found.");
            return 3;
        }
        FreeConsole();
        if (!AttachConsole(target))
        {
            Console.Error.WriteLine(new Win32Exception(Marshal.GetLastWin32Error()).Message);
            return 3;
        }
        IntPtr input = CreateFile("CONIN$", GenericRead | GenericWrite,
            FileShareRead | FileShareWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
        if (input == InvalidHandleValue)
        {
            Console.Error.WriteLine(new Win32Exception(Marshal.GetLastWin32Error()).Message);
            return 4;
        }
        try
        {
            uint written;
            InputRecord[] buffer = records.ToArray();
            if (!WriteConsoleInputW(input, buffer, (uint)buffer.Length, out written) || written != buffer.Length)
            {
                Console.Error.WriteLine("Only part of the /rename text reached the Codex console.");
                return 5;
            }
            return 0;
        }
        finally { CloseHandle(input); }
    }
}
