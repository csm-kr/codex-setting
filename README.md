# codex-setting

Codex 프로젝트별 설정을 보관하는 저장소입니다.

현재 포함된 설정은 새 세션의 첫 사용자 요청을 짧은 한국어 제목으로 요약하여 세션 이름을 자동 변경하는 프로젝트 로컬 훅입니다.

## 동작 방식

- `UserPromptSubmit`에서 실행됩니다.
- 세션 이름이 비어 있을 때만 한 번 실행됩니다.
- `gpt-5.4-mini`와 낮은 추론 강도로 제목을 생성합니다.
- 제목 생성용 Codex 실행은 `--ephemeral`이므로 별도 세션으로 저장되지 않습니다.
- AI 제목 생성이 실패하면 첫 요청을 정리하고 잘라낸 제목을 사용합니다.
- 기존에 이름이 있는 세션은 변경하지 않습니다.

## 파일

- `.codex/hooks.json`: 프로젝트 로컬 훅 등록
- `.codex/hooks/auto_rename_session.ps1`: 제목 생성 및 `thread/name/set` 호출

## 다른 프로젝트에 적용

대상 프로젝트 루트에 다음 두 파일을 같은 구조로 복사합니다.

```text
<project>/.codex/hooks.json
<project>/.codex/hooks/auto_rename_session.ps1
```

Codex를 대상 프로젝트 루트에서 시작하세요. 처음 훅 신뢰 경고가 표시되면 `/hooks`에서 해당 프로젝트 훅을 승인합니다. 이미 열린 세션은 새 훅을 바로 읽지 않을 수 있으므로 새 세션을 시작하거나 앱을 다시 여는 것이 안전합니다.

## 요구 사항

- Windows PowerShell 5 이상
- 로그인된 Codex CLI
- `gpt-5.4-mini` 사용 권한

이 설정은 사용자 전역 `~/.codex`를 수정하지 않습니다.
