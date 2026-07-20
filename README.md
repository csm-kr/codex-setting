# codex-setting

첫 사용자 요청의 의도를 짧게 요약하고 Codex CLI 입력창에 다음 텍스트만 넣는
프로젝트 로컬 훅입니다.

```text
/rename "요약된 세션 제목"
```

Enter는 자동으로 누르지 않습니다. 사용자가 내용을 확인한 뒤 직접 Enter를 눌러
세션 제목을 확정합니다.

## 동작

1. `UserPromptSubmit`에서 첫 번째 구체적인 사용자 요청을 읽습니다.
2. 별도의 임시 Codex 실행으로 2~6단어 제목을 생성합니다.
3. 현재 Codex CLI 입력창에 `/rename "제목"`을 삽입합니다.
4. 사용자가 직접 Enter를 누릅니다.

App Server, SQLite 직접 수정, 자동 Enter, Desktop App 연동은 사용하지 않습니다.

## 설치

```bash
git clone https://github.com/csm-kr/codex-setting.git
cd codex-setting
node install.mjs install "/absolute/path/to/project"
```

Windows PowerShell 예시:

```powershell
node .\install.mjs install "C:\path\to\project"
```

설치 후 새 Codex CLI 세션에서 `/hooks`를 열어 이 프로젝트 훅을 승인합니다.

## 관리

```bash
node install.mjs update "/absolute/path/to/project"
node install.mjs status "/absolute/path/to/project"
node install.mjs uninstall "/absolute/path/to/project"
```

## 플랫폼

- Windows: 콘솔 입력 큐에 텍스트만 삽입합니다.
- macOS: `/dev/tty` 입력을 먼저 시도하고, 차단되면 기본 제공 AppleScript로
  현재 터미널에 텍스트를 붙여넣습니다. 최초 실행 시 터미널의 손쉬운 사용 권한을
  허용해야 할 수 있습니다.
- Ubuntu: `/dev/tty` 입력을 먼저 시도하고, 차단되면 Wayland의 `wtype`, X11의
  `xdotool` 순서로 시도합니다. 해당 환경에서는 둘 중 맞는 도구 하나가 필요합니다.

삽입 실패는 운영체제 임시 폴더의
`codex-rename-prompt-hook-v1/errors.log`에 기록됩니다.

Node.js 18 이상, 로그인된 Codex CLI가 필요합니다. macOS·Ubuntu 설치에는 C
컴파일러(`cc`), Windows 설치에는 기본 .NET Framework C# 컴파일러가 필요합니다.

## 수동 검사

```bash
node .codex/hooks/rename_prompt_hook.mjs --suggest "사용자 요청"
node .codex/hooks/rename_prompt_hook.mjs --insert "테스트 제목"
```

`--insert`도 Enter를 보내지 않습니다.
