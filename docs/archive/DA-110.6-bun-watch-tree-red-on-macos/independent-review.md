# Независимое ревью семи native lifecycle сценариев

Вердикт по коду: **ACCEPT**, Critical **0**, Major **0**, Minor **0**. Это результат статического ревью изменения тестового запуска, а не завершение qualification или acceptance задачи.

- Repository: `/Users/kim.p/AtiWorkspace/workspace/sandbox/diffalanche-execution-20261101/stabilization`.
- Reviewed HEAD: `a87e98927cb171464d3fc4911653412f931ccab7`.
- Commit base: `ac0fe0247e4105ad04c18fd4111de911a64c992d`.
- Equivalence source: `1bfb4badfc2fd71c74d60e94e5a1d7d1feecc140:tests/watch-tree.test.ts`.
- Ветка при чтении: `execution/stabilization-20261101`; `git status --short --branch` показал только имя ветки. Fetch не выполнялся, отставание от удалённого репозитория не устанавливалось.
- Область: семь сценариев группы `a directory that comes, goes and comes back`, общий helper, child runner и обработка ошибок/cleanup. Product/runtime-код вне изменения.

## Findings

Critical: 0. Major: 0. Minor: 0.

Не обнаружено ослабления проверяемых условий, пропуска сценария или замены native watching на polling. Изменение места исполнения на macOS/Bun явное и ограниченное. Показанные успехи отдельного процесса не доказывают устранение неизвестной причины первоначального отказа.

## Сопоставление сценариев

Ниже строки относятся к `tests/helpers/native-directory-cases.ts` на reviewed HEAD. Проверены тела исходных семи тестов из equivalence source, а не только предоставленная владельцем таблица `native-case-mapping.json`.

| Сценарий | Строки | Сохранённое условие |
|---|---:|---|
| `is watched when it is made after the start, with what was already in it` | 69–94 | Однократное создание `made/deep/first.ts` после `arm`, ожидание именно этого пути, последующая однократная запись `made/deep/later.ts`, `fellBack() === 0`. |
| `reports what a new directory held before a name written after it` | 95–123 | 5 раундов; nested file и root marker создаются в прежнем порядке; наличие nested file и его позиция до marker проверяются отдельно. |
| `reports a burst of thousands of names in one directory in linear time and memory` | 124–167 | 5000 файлов из синхронного отдельного writer, прежний marker, sampling каждые 20 ms, тот же фильтр `out/`; Node требует 5000 имён, Bun — больше 0; heap delta строго меньше `200 * 1024 * 1024`. |
| `is watched again when it is removed and made again under its name` | 168–194 | 3 раунда `rm -rf && mkdir`, в каждом отдельные подтверждённые `y` и `z`, `fellBack() === 0`. |
| `is watched again when another is moved in over its name` | 195–221 | 3 раунда прежней последовательности `mkdir next && rm -rf dist && mv next dist`, два подтверждённых пути в каждом, `fellBack() === 0`. |
| `is watched again after a checkout removed it and made it again` | 222–271 | Та же подготовка двух Git branches и `repositoryIgnore`, переходы `other/b.ts`, `main/a.ts`, `other/b.ts`, запись и ожидание после каждого checkout, восстановление файла, `fellBack() === 0`. |
| `is let go when it is removed, and the rest of the tree stays watched` | 272–299 | Ожидание `gone` после удаления, затем новая граница `heard.length` перед записью `kept/after.ts`, ожидание именно этого нового пути, `polling() === false`, `fellBack() === 0`. |

Замены `expect(...).toBe(...)` на `assert.equal` для boolean/count, и сравнений `toBeGreaterThan[OrEqual]`/`toBeLessThan` на `assert.ok` сохраняют predicates для этих конкретных значений. Для ordering и burst не добавлены новые fallback-assertions: их отсутствие было в исходнике и не является ослаблением в этом diff.

## Native path, сроки и обработка отказа

- `tests/watch-tree.test.ts:115–130` регистрирует все 7 записей через обычный `it`, без нового skip. Условие child-запуска — одновременно `darwin` и наличие `process.versions.bun`; в остальных случаях вызывается та же функция `scenario(dir)`.
- `tests/watch-tree.test.ts:121–125` использует `process.execPath`, наследуемое окружение и настоящий `execFile`, без shell-обёртки и подмены runtime. `DIFFALANCHE_TEST_RUNTIME` наследуется; исходный критерий `NATIVE_NAMES` перенесён без изменения.
- `tests/helpers/native-directory-cases.ts:16–34` сохраняет `native: perDirectory` на Linux и macOS, `pollIntervalMs = 250`, callbacks и непосредственный вызов публичного `watchTree`. Новый child не импортирует Vitest и не подменяет `fs.watch`.
- `heardAfter` сохраняет deadline 20 000 ms и sleep 5 ms (`:38–43`), `arm` — ready, deadline 20 000 ms и повтор каждые 50 ms (`:54–61`). После arming сценарные записи не повторяются для получения удобного события. Предметные временные границы и `from` сохранены.
- Child deadline 60 000 ms (`tests/watch-tree.test.ts:122`) совпадает с прежним test timeout в неизменённом `vitest.config.ts`; это предел процесса, не расширение 20-секундных ожиданий.
- `tests/helpers/native-directory-child.ts:12–17` создаёт и удаляет отдельный capability fixture. Вызов probe соответствует прежнему `beforeAll`, но не меняет явно выбранный `perDirectory`.
- Все 7 `catch` пишут `nativeFailure` с `heard`, `polling` и `fellBack` **перед** `finally`, затем повторно выбрасывают ошибку. Например, removal — `:284–297`, creation — `:79–92`. Отказ не превращается в успешный JSON.
- `tests/helpers/native-directory-child.ts:18–19` печатает `{ ok: true }` только после успешного сценария. Ошибка top-level await даёт неуспешный child, `execFile` отклоняет promise; нормальный ответ дополнительно проверяется родителем.
- В каждом сценарии `finally` закрывает watcher перед удалением fixture. Родительский `finally` повторно удаляет fixture с `force: true`, в том числе после ошибки подготовки или отказа child. Burst дополнительно очищает sampling interval в `finally`; раньше при отказе до `clearInterval` он мог остаться активным. Это улучшение cleanup без изменения точки измерения успешного сценария.

## Прочитанные улики предыдущих отказов

Это результаты владельца, прочитанные из raw receipts/stdout/stderr; ревьюер не повторял эти прогоны.

- `logs/qualification-bun-2.json` и `.stderr`: `env -u FORCE_COLOR bun run test:bun`, HEAD `1bfb4badfc2fd71c74d60e94e5a1d7d1feecc140`, exit **1**. Полное имя: `tests/watch-tree.test.ts > a directory that comes, goes and comes back > is let go when it is removed, and the rest of the tree stays watched`. Assertion: `Error: kept/after.ts was not heard`.
- `logs/qualification-v2-bun-2.json` и `.stderr`: та же команда, HEAD `ac0fe0247e4105ad04c18fd4111de911a64c992d`, exit **1**. Полное имя: `tests/watch-tree.test.ts > a directory that comes, goes and comes back > is watched when it is made after the start, with what was already in it`. Assertion: `Error: made/deep/later.ts was not heard`.
- `logs/watch-removal-control-{1,2,base}.json`: `env -u FORCE_COLOR bun run test:bun -- tests/watch-tree.test.ts -t 'is let go when it is removed, and the rest of the tree stays watched'`, exits **0, 0, 0**. Первые два — `1bfb4bad...`; base — `603d11b8354786f6fbc2cb318534e4d91a481d45`.
- `logs/watch-created-control-{1,2,base}.json`: `env -u FORCE_COLOR bun run test:bun -- tests/watch-tree.test.ts -t 'is watched when it is made after the start, with what was already in it'`, exits **0, 0, 0**. Первые два — `ac0fe024...`; base — `603d11b8354786f6fbc2cb318534e4d91a481d45`.
- `logs/watch-removal-public-bun.json`: `bun /Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/stabilization/watch-removal-observer/public-case.ts /Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/stabilization/watch-removal-observer/public-bun.json`, exit **0**, HEAD `1bfb4bad...`.
- `logs/watch-created-public-bun.json`: `bun /Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/stabilization/watch-removal-observer/public-created.ts /Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/stabilization/watch-removal-observer/public-created-bun.json`, exit **0**, HEAD `ac0fe024...`.
- Отдельно прочитаны оба JSON с событиями: в каждом **20/20** rows имеют `failure: null`, `fallback: 0`, `polling: false` и оба ожидаемых пути; Bun **1.3.14**. Это ограниченные standalone-замеры, не доказательство поведения полного тестового процесса.

Причина расхождения full suite / isolated / standalone: **UNKNOWN**. Ни «flaky», ни нагрузка, ни Vitest как установленная причина из этих данных не следуют. Child является явным тестовым workaround, разрешённым bounded diagnostic plan карточки `DA-110.6 — Under Bun on macOS the directory cases of the watch tree are not heard: test:bun is red on an untouched base`.

## Команды ревьюера

Runtime-тестов запущено **0**, mutation probes **0**, full gates **0**. Выполнен обязательный startup lint **1/1**; он не заменяет final gates.

Все repository-команды выполнялись из repository, указанного выше; `npx ati-agents rules` — из `/Users/kim.p/AtiWorkspace/workspace`.

| Команда | Exit | Улика |
|---|---:|---|
| `npx ati-agents rules /Users/kim.p/AtiWorkspace/workspace/sandbox/diffalanche-execution-20261101/stabilization` | 0 | Применимы база, workspace, my-voice и repository AGENTS; модулей для sandbox нет. |
| `npx --no-install backslop lint --require-adapter codex` | 0 | files 94, links 728, local 710, anchors checked 175; no errors. |
| `git rev-parse HEAD` | 0 | `a87e98927cb171464d3fc4911653412f931ccab7`. |
| `git status --short --branch` | 0 | Только `## execution/stabilization-20261101`, до и после чтения. |
| `git diff --name-only ac0fe0247e4105ad04c18fd4111de911a64c992d a87e98927cb171464d3fc4911653412f931ccab7` | 0 | Только 4 тестовых файла: shared cases, child, удалённый old removal helper, watch-tree test. |
| `git diff ac0fe0247e4105ad04c18fd4111de911a64c992d a87e98927cb171464d3fc4911653412f931ccab7 -- src docs package.json vitest.config.ts` | 0 | Пустой diff. |
| `git show 1bfb4badfc2fd71c74d60e94e5a1d7d1feecc140:tests/watch-tree.test.ts` | 0 | Исходные helpers и все семь сценариев прочитаны. |
| `git show ac0fe0247e4105ad04c18fd4111de911a64c992d:tests/helpers/removed-directory.ts` | 0 | Сопоставлен прежний removal child и его captured outcome. |

## Что остаётся незакрытым

- Новая qualification-серия и probes на `a87e989` не приняты этим ревью. Их результаты должен отдельно проверить владелец; passing static review не заменяет 3 последовательных обычных Bun full-suite прогона и остальные обязательные проверки.
- `docs/reference/05-watcher.md:1106` пока не описывает запуск всех семи shared cases в macOS/Bun child. Это pending-условие уже запланированного **DA-155 writer pass**, а не новая независимая minor-карточка и не запрет на предусмотренную документацию. Основание: `PLAN.md:13`, `QUALIFICATION-PLAN-v2.md:5` и уточнение владельца в этом review. До закрытия writer должен описать семь сценариев, оба полных отказа, границы измерений и UNKNOWN cause; черновик, описывающий только removal case, недостаточен.
- Product native watcher не исправлялся этим commit. Причина первоначальных отказов не установлена. Linux/Node не запускались ревьюером; сохранение их сценарных условий подтверждено чтением кода, не новым live measurement.
- Репозиторий не редактировался. Единственная запись ревьюера — этот отчёт вне Git repository; тяжёлые тесты, fetch, push, commit, archive и изменение карточек не выполнялись.
