# codex-setting

첫 사용자 명령의 **의도**를 짧게 요약하고 Codex 스레드 제목으로 자동 설정하는 프로젝트 로컬 훅입니다.

Windows, macOS, Ubuntu에서 같은 Node.js 소스를 사용합니다. 전역 `~/.codex` 설정은 건드리지 않으며, 설치 대상으로 지정한 프로젝트의 `.codex` 폴더만 변경합니다.

## 동작 방식

1. 새 스레드의 첫 명령이 들어오면 `UserPromptSubmit` 훅이 실제 의도를 파악해 같은 언어의 2~6단어 제목을 만듭니다.
2. Codex의 `thread/name/set` API로 해당 스레드 제목을 설정합니다.
3. 첫 응답이 끝나는 `Stop` 시점에 같은 제목을 한 번 더 적용합니다. Codex 기본 제목 생성이 원문으로 덮어쓰는 경쟁 조건을 막기 위한 단계입니다.
4. 이후 명령에서는 실행하지 않으며, 이미 사용자가 직접 이름을 정한 스레드도 덮어쓰지 않습니다.

제목 생성용 실행은 임시 세션(`--ephemeral`)이고 훅을 비활성화하므로 재귀 실행되지 않습니다. 제목 생성이 실패해도 사용자 작업은 막지 않으며, 원문이나 코드 조각 대신 안전한 일반 제목을 사용합니다.

## 요구 사항

- Windows 10/11, macOS 또는 Ubuntu
- Node.js 18 이상
- 로그인된 Codex CLI
- 기본 제목 모델인 `gpt-5.4-mini` 사용 권한

다른 모델을 쓰려면 Codex를 시작하기 전에 `CODEX_THREAD_TITLE_MODEL` 환경 변수로 지정할 수 있습니다.

## 설치

저장소를 받은 뒤 어느 운영체제에서나 같은 명령을 사용합니다.

```bash
git clone https://github.com/csm-kr/codex-setting.git
cd codex-setting
node install.mjs install "/absolute/path/to/project"
```

Windows PowerShell 예시:

```powershell
git clone https://github.com/csm-kr/codex-setting.git
Set-Location codex-setting
node .\install.mjs install "C:\work\my-project"
```

설치기는 기존 `.codex/hooks.json`의 다른 훅을 그대로 보존하고, 이 저장소가 관리하는 두 훅만 추가하거나 갱신합니다. 설치 후 대상 프로젝트를 Codex에서 열고 `/hooks`를 실행해 새 훅을 승인한 다음 새 세션을 시작하세요. 훅 내용이 바뀌면 보안 해시도 바뀌므로 `/hooks`에서 다시 승인해야 합니다.

## 관리 명령

```bash
# 설치 또는 최신 버전으로 갱신
node install.mjs update "/absolute/path/to/project"

# 파일과 두 이벤트 등록 상태 확인
node install.mjs status "/absolute/path/to/project"

# 이 저장소가 관리하는 훅만 제거
node install.mjs uninstall "/absolute/path/to/project"

# 소스 문법 검사
npm run check
```

동작 중 상태와 오류 로그는 프로젝트가 아니라 운영체제 임시 폴더의 `codex-session-auto-rename-v2` 아래에 저장됩니다. 7일이 지난 상태 파일은 자동 정리됩니다.

## 설치되는 파일

```text
<project>/.codex/hooks.json
<project>/.codex/hooks/auto_rename_session.mjs
```

저장소의 `hook/auto_rename_session.mjs`가 단일 원본입니다. 각 프로젝트에는 `install.mjs`가 이 원본을 복사하고, 해당 컴퓨터에 맞는 절대 경로를 `hooks.json`에 기록합니다.
