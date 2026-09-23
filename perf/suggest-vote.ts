/** How `k`, the temperature and the floor of `src/core/ml/suggest` were chosen: forty labelled
 * comments and eight unrelated texts. Not a gate; 09-ml.md, "Suggestions", has the result. */
import { defaultCacheHome, modelDirectory } from "../src/core/ml/embed/cache.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "../src/core/ml/embed/model.ts";
import { openEmbedder } from "../src/core/ml/embed/open.ts";
import type { EmbeddingIndex, IndexEntry, Neighbour } from "../src/core/ml/index/index.ts";
import { nearest } from "../src/core/ml/index/index.ts";
import { proposeSeverity } from "../src/core/ml/suggest/index.ts";
import type { Severity } from "../src/core/storage/index.ts";

const FINDINGS: { severity: Severity; texts: string[] }[] = [
  {
    severity: "critical",
    texts: [
      "The query is built by concatenating user input: this is an SQL injection.",
      "User input goes straight into the SQL string; use a parameterized query.",
      "Здесь SQL собирается конкатенацией с пользовательским вводом — это инъекция.",
      "Параметры запроса подставляются в строку SQL напрямую, нужен параметризованный запрос.",
    ],
  },
  {
    severity: "critical",
    texts: [
      "The access token is written to the log in plain text.",
      "We log the whole request including the Authorization header.",
      "Токен доступа попадает в лог открытым текстом.",
      "В лог пишется весь запрос вместе с заголовком Authorization.",
    ],
  },
  {
    severity: "critical",
    texts: [
      "Two requests can read the balance at once and both debit it: a race condition.",
      "The check and the update are not atomic; concurrent calls can double-spend.",
      "Два запроса одновременно читают баланс и оба списывают — гонка.",
      "Проверка и обновление не атомарны, параллельные вызовы спишут дважды.",
    ],
  },
  {
    severity: "warning",
    texts: [
      "This runs one query per order inside the loop: an N+1.",
      "Each iteration hits the database again; load the items in one query.",
      "В цикле на каждую запись отдельный запрос к базе — классический N+1.",
      "Запросы в базу идут внутри цикла, лучше загрузить всё одним запросом.",
    ],
  },
  {
    severity: "warning",
    texts: [
      "The HTTP call has no timeout, a slow upstream will hang this request.",
      "No cancellation token is passed to the outgoing call.",
      "У HTTP-вызова нет таймаута, медленный сервис подвесит запрос.",
      "CancellationToken не прокидывается во внешний вызов.",
    ],
  },
  {
    severity: "warning",
    texts: [
      "This catch block swallows the error silently. Log it or rethrow.",
      "The exception is caught and ignored; failures will be invisible.",
      "Ошибка тут просто глотается в catch, надо хотя бы залогировать.",
      "Исключение перехватывается и игнорируется, сбой никто не увидит.",
    ],
  },
  {
    severity: "nit",
    texts: [
      "The name says filter but the function maps; rename it.",
      "Consider a clearer name: data2 says nothing about what it holds.",
      "Имя функции говорит filter, а она делает map — переименовать.",
      "Название переменной data2 ничего не говорит, лучше переименовать.",
    ],
  },
  {
    severity: "nit",
    texts: [
      "Unused import.",
      "This helper is never called anywhere; remove it.",
      "Неиспользуемый импорт.",
      "Этот метод нигде не вызывается, можно удалить.",
    ],
  },
  {
    severity: "nit",
    texts: [
      "Typo in the comment: recieve.",
      "Trailing whitespace and a missing newline at the end of the file.",
      "Опечатка в комментарии: получаеться.",
      "Лишние пробелы в конце строк и нет перевода строки в конце файла.",
    ],
  },
  {
    severity: "question",
    texts: [
      "Why is the retry count hard-coded here instead of coming from config?",
      "What happens here when the list is empty — is that expected?",
      "Почему число повторов зашито в код, а не берётся из конфигурации?",
      "Что будет, если список пустой, — это ожидаемое поведение?",
    ],
  },
];

const UNRELATED = [
  "Looks good to me.",
  "Nice refactoring, thanks!",
  "The colour of the button should match the design system.",
  "Please update the README with the new flag.",
  "Можно добавить скриншот в описание?",
  "Спасибо, отличная работа.",
  "Bump the version in package.json.",
  "Легенда графика наезжает на ось на маленьких экранах.",
];

const embedder = await openEmbedder(modelDirectory(defaultCacheHome(), EMBEDDING_MODEL));
const entries: (IndexEntry & { finding: number })[] = FINDINGS.flatMap((finding, f) =>
  finding.texts.map((body, t) => ({
    session: "corpus",
    id: `c_${f}_${t}`,
    severity: finding.severity,
    repo: null,
    path: null,
    line: null,
    body,
    finding: f,
  })),
);
const vectors = await embedder.embed(entries.map((entry) => entry.body));
const dimensions = EMBEDDING_MODEL.dimensions;
const all = new Float32Array(entries.length * dimensions);
vectors.forEach((vector, row) => {
  all.set(vector, row * dimensions);
});
const index: EmbeddingIndex = {
  identity: embeddingIdentity(),
  dimensions,
  updatedAt: "",
  sessions: {},
  entries,
  vectors: all,
};

/** The neighbours of row `row` with itself left out. */
function others(row: number, k: number): Neighbour[] {
  const self = entries[row] as IndexEntry;
  return nearest(index, vectors[row] as Float32Array, { k: k + 1 })
    .filter((one) => one.id !== self.id)
    .slice(0, k);
}

const firsts = entries.map(
  (entry, row) => others(row, 1)[0]?.id.split("_")[1] === `${entry.finding}`,
);
const related = entries.map((_, row) => others(row, 1)[0]?.similarity ?? 0).sort((a, b) => a - b);
const unrelated = (await embedder.embed(UNRELATED))
  .map((query) => nearest(index, query, { k: 1 })[0]?.similarity ?? 0)
  .sort((a, b) => a - b);
process.stdout.write(
  `${JSON.stringify({
    nearestIsSameFinding: `${firsts.filter(Boolean).length}/${entries.length}`,
    nearestSimilarity: { lowest: related[0], median: related[20], highest: related.at(-1) },
    unrelatedNearestSimilarity: { lowest: unrelated[0], highest: unrelated.at(-1) },
  })}\n`,
);

for (const k of [1, 3, 5, 10]) {
  for (const temperature of [0.005, 0.01, 0.02, 0.05, 1_000]) {
    let right = 0;
    const confidence = { right: [] as number[], wrong: [] as number[] };
    entries.forEach((entry, row) => {
      const proposal = proposeSeverity(others(row, k), temperature, 0);
      const ok = proposal?.severity === entry.severity;
      if (ok) right += 1;
      (ok ? confidence.right : confidence.wrong).push(proposal?.confidence ?? 0);
    });
    const mean = (values: number[]) =>
      values.length === 0
        ? null
        : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    process.stdout.write(
      `${JSON.stringify({ k, temperature, severityRight: `${right}/${entries.length}`, confidenceWhenRight: mean(confidence.right), confidenceWhenWrong: mean(confidence.wrong) })}\n`,
    );
  }
}
