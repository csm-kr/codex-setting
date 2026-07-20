#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int run_program(char *const arguments[]) {
  pid_t child = fork();
  if (child < 0) return -1;
  if (child == 0) {
    execvp(arguments[0], arguments);
    _exit(127);
  }
  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) return -1;
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

static int insert_with_tiocsti(const char *command) {
#ifndef TIOCSTI
  (void)command;
  return -1;
#else
  int tty = open("/dev/tty", O_RDWR);
  if (tty < 0) return -1;
  for (size_t index = 0; command[index] != '\0'; index++) {
    char byte = command[index];
    if (ioctl(tty, TIOCSTI, &byte) < 0) {
      close(tty);
      return -1;
    }
  }
  close(tty);
  return 0;
#endif
}

int main(int argc, char **argv) {
  if (argc < 2 || argv[1][0] == '\0') {
    fprintf(stderr, "A non-empty title is required.\n");
    return 2;
  }

  size_t title_length = 0;
  for (int index = 1; index < argc; index++) {
    if (strpbrk(argv[index], "\r\n\"") != NULL) {
      fprintf(stderr, "The title must not contain quotes or line breaks.\n");
      return 2;
    }
    title_length += strlen(argv[index]) + (index > 1 ? 1 : 0);
  }
  char *command = malloc(title_length + 12);
  if (!command) {
    fprintf(stderr, "Out of memory.\n");
    return 4;
  }
  strcpy(command, "/rename \"");
  for (int index = 1; index < argc; index++) {
    if (index > 1) strcat(command, " ");
    strcat(command, argv[index]);
  }
  strcat(command, "\"");

  if (insert_with_tiocsti(command) == 0) {
    free(command);
    return 0;
  }

#ifdef __APPLE__
  char *osascript[] = {
    "/usr/bin/osascript",
    "-e", "on run argv",
    "-e", "set previousClipboard to the clipboard",
    "-e", "set the clipboard to item 1 of argv",
    "-e", "tell application \"System Events\" to keystroke \"v\" using command down",
    "-e", "delay 0.2",
    "-e", "set the clipboard to previousClipboard",
    "-e", "end run",
    command,
    NULL,
  };
  if (run_program(osascript) == 0) {
    free(command);
    return 0;
  }
#else
  char *wtype[] = { "wtype", "--", command, NULL };
  if (run_program(wtype) == 0) {
    free(command);
    return 0;
  }

  char *xdotool[] = {
    "xdotool", "type", "--clearmodifiers", "--delay", "0", "--", command, NULL,
  };
  if (run_program(xdotool) == 0) {
    free(command);
    return 0;
  }
#endif

  fprintf(stderr, "No permitted terminal text-insertion method succeeded: %s\n", strerror(errno));
  free(command);
  return 6;
}
