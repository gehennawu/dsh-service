# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Repo inferred from `git remote -v`: `gehennawu/dsh-service`.

## 本环境工作流（gh CLI 缺席时的替代）

本容器**未安装 gh CLI**。所有 issue 操作统一用 curl + 存量凭据调 GitHub REST API：

```bash
TOK=$(grep -oP '(?<=://)[^:@]+:[^@]+(?=@github.com)' ~/.git-credentials | cut -d: -f2 | head -1)
curl -s -H "Authorization: token $TOK" https://api.github.com/...
```

token 不回显、不落日志（存进 shell 变量再引用）。

常用操作：

- **读 issue**：`GET /repos/gehennawu/dsh-service/issues/<n>`（含 body 与 labels）；评论列表 `GET .../issues/<n>/comments`
- **建 issue**：`POST /repos/gehennawu/dsh-service/issues`，JSON body `{"title":"...","body":"..."}`
- **评论**：`POST .../issues/<n>/comments`，JSON body `{"body":"..."}`
- **标签增删**：`POST .../issues/<n>/labels` body `{"labels":["needs-info"]}`；删除 `DELETE .../issues/<n>/labels/<name>`
- **关闭/重开**：`PATCH .../issues/<n>`，JSON body `{"state":"closed"}`（关闭说明先发一条 comment）

GitHub API 的 JSON 用 python3 解析即可（环境无 jq 保证）：`| python3 -c "import json,sys; d=json.load(sys.stdin); ..."`。

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a GitHub issue（用上面的 `POST .../issues` 端点）。

## When a skill says "fetch the relevant ticket"

`GET /repos/gehennawu/dsh-service/issues/<n>`，需要讨论上下文时追加 `GET .../issues/<n>/comments`。

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: 单个打 `wayfinder:map` 标签的 issue，正文承载 Notes / Decisions-so-far / Fog。
- **Child ticket**: 通过 `Part of #<map>` 正文行 + task-list 挂靠到 map（sub-issues API 不可用时的回退）；标签 `wayfinder:<type>`（research/prototype/grilling/task）。认领后 assign 给驱动会话。
- **Blocking**: 优先用 GitHub 原生 issue dependencies（注意用 database id，不是 `#number` 或 node_id）；依赖特性不可用时回退子 issue 正文顶部 `Blocked by: #<n>, #<n>` 行。全部 blocker 关闭即解除。
- **Frontier query**: 列 map 的 open children，去掉有 open blocker 或已被认领的，按 map 内顺序取首个。
- **Claim**: 第一个对 ticket 的写操作 = 把自己设为 assignee。
- **Resolve**: 评论结论 → 关闭 → 在 map 的 Decisions-so-far 追加上下文指针。
