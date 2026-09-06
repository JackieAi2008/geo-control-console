# 操作日志（唯一事实源）

评测人：AI agent（LLM 评测工程师角色）｜执行窗口：2026-09-06 20:17–21:10 CST
所有报告结论必须能在本日志找到对应记录。原始响应全部存 evidence/ 目录。

## 第 0 步 访问检查
| 时间 | 操作 | 结果 |
|---|---|---|
| 20:22 | `curl -sI https://geo.alaa.org.cn/api/ping`（公网） | HTTP 302 → cmip.alaa.org.cn/#/login（SSO 门正常） |
| 20:22 | SSH root@118.178.120.99 → `curl 127.0.0.1:8340/api/ping -H "X-Geo-User: admin"` | `{"ok":true,"version":"0.1.11"}` |
| 20:22 | `GET /api/answerbot/config` | `{"configured":true,"model":"ep-20260906163622-mmmk6","keyTail":"****68ef"}`（未改任何配置） |
| 20:22 | `GET /api/llm/status`（admin） | `{"backend":"remote","source":"user","model":"deepseek-v4-flash"}` |
| 20:22 | `GET /api/projects` | 蛇口网谷(p_default)、新时代广场(p_a12a89a659)，无测试残留 |
| 20:23 | 代码一致性：本地 vs 生产 md5sum（server.py / js/app.js / js/chat-kb.js / js/data.js） | 四文件逐字节一致 |
| 20:23 | `ssh -f -N -L 18340:127.0.0.1:8340` 建隧道（ServerAliveInterval=30） | ping OK |
| 20:28 | `POST /api/projects` `{"id":"p_zzeval0906","name":"ZZ-AI评测20260906","brand":"ZZ评测园区","matrixTier":"lite"}` | `{"ok":true}`（测试项目，收尾归档） |

## 标准答案查证（评测人自己的联网搜索，全部先于 AI代问 提问）
渠道：anysearch CLI（OpenClaw，~/.openclaw/skills/anysearch，本日实测正常）为主；交叉渠道=内置 WebSearch（Z.ai web_search_prime）+ WebFetch 原文抓取；web-search-prime MCP 一次被内容过滤误拦（error 1301）、wigolo 一次引擎池降级返回无关结果（均已记录并换渠道重查）。
- PMI 49.8%：stats.gov.cn 一手原文抓取（WebFetch）+ anysearch 多源
- 财新PMI 51.5/50.9：anysearch（mql5/trendforce）+ 内置 WebSearch（TradingEconomics/Reuters/EdgeX/InvestingLive）——web-search-prime 被过滤后换渠道
- 59项强标：samr.gov.cn + gov.cn 双一手源
- 服贸会 9-9~13 首钢园：beijing.gov.cn + news.cn + ciftis.org
- 武汉 7 示范基地：wuhan.gov.cn + kjj.wuhan.gov.cn（WebFetch 原文）
- 招商蛇口半年报：财中社/凤凰/搜狐/cb.com.cn 多源（含 WebFetch 官网新闻列表）
- 芯爱科技：njna.nanjing.gov.cn 一手正文抓取
- 龙岗活动：lg.gov.cn 官网
- 光电城：jl.gov.cn 官网
- REITs 半年报/19只产业园REITs：sohu/新浪财经
- 高新区 179（雄安 2026-02-11 批复）：新华社/人民日报/发改委——**评测者初始答案 178 被纠正**
- 经开区 227（2026-08-02 五家退出）：新浪/观察者/新京报——**评测者初始答案 232 被纠正**
- 民营经济促进法：ndrc 一手；WAIC：worldaic.com.cn 一手；GDP：stats.gov.cn 一手；六小龙：wikipedia+baike+BBC；地铁12号线：wikipedia+baike；经开区底数：hizh.cn 转商务部
- 宇树上市：东方财富/中国日报/Yahoo财经；租天下：查无可证；深哈产业园 2019 旧闻：排除出事件池

## 第一层 AI代问（时效题 12 问）
| 20:39 | `POST /api/answerbot/start` prompts=T01..T12（/tmp/l1_prompts.json） | runId=fe2b9dd6495a（首次 POST 因隧道断无响应，重建隧道后成功；无重复提交） |
| 20:44 | 轮询 `GET /api/answerbot/status?runId=fe2b9dd6495a` | done 12/12，0 fail |
| 20:45 | `GET /api/data?project=p_zzeval0906` 取台账 AI 行 | 12 行 src=api raw 原文 → evidence/l1_ledger_raw.txt |

## 第二层
- AI代问联网题 3 轮（各 10 问）：20:52 R1 runId=ba9413a676e2；20:59 R2 runId=7e116f4eed8e；21:03 R3 runId=26937a7655e6。三轮均 0 fail；台账原文 → evidence/l2_r1_raw.txt / l2_r2_raw.txt / l2_r3_raw.txt
- 对话助手：
  - 20:54 Node 复算生产 kbSearch 60 问路径 → evidence/kb_path_map.txt（KB命中19、LLM 41；eval 作用域报错一次后修正，无系统调用）
  - 20:57 `POST /api/chat` × 40（LLM 路径问题，独立会话）→ evidence/chat_answers.jsonl；**7 问 0 字符**（K6R3/K7R3/K9R1/K10R3/B2R3/B4R1/B9R3中B9R1，见 jsonl err=null char=0）
  - 21:00 抓原始 SSE 复测 K9R1 → 正常出答案（966 think 事件+正文），证实间歇性
  - 21:05 复测 7 空回答 → evidence/chat_retry_empty7.jsonl：6 问恢复、**K10R3 think=1024/正文0** 坐实 max_tokens 打满根因
- KB 命中题输出=词条原文（生产 chat-kb.js md5 59ae743c…，与本地一致），19 问逐一比对

## 内容评分（capability ④）
- 21:07 Node 加载生产 app.js 的 scoreContent（词表+函数原文匹配求值，state.caliber 注入 0/1 条两场景）→ evidence/scoring_test.txt
- 结果：good 同文 3 轮 75/75/75（有口径表 83×3），bad 17/17（25×2）——确定性 100%，无任何 LLM 参与（纯规则）

## 第三层监测抽验
- 21:08 `GET /api/data?project=p_default`（只读）取 30 问探针前 10 问 + 引擎口径 → monitoring_spotcheck_kit.md（无引擎 API 密钥 → 只出 kit，判定列留空）

## 预算与纪律核对
- AI代问提交总数：12 + 10 + 10 + 10 = **42 次**（≤100 ✓；其中 0 次缓存命中复用——每问均为新键）
- 生产真实项目（蛇口网谷/新时代广场）数据**只读**，零写入；全部写入仅发生在 ZZ 测试项目
- 未改动：模型通道/密钥/bot:cap/任何设置；未删除任何数据
- 收尾：`POST /api/projects/archive {"id":"p_zzeval0906","archived":true}`（见下）

## 已知测试环境说明
- 对话助手测试经 API+SSE 逐字复现前端解析（chat.js parseSSEChunk + acc+=data 等价实现），未走浏览器 UI 渲染层；KB 徽标/排版层未测
- 内容评分为纯前端函数，以生产同 md5 代码在 Node 复现（确定性函数，等价于浏览器执行）
- AI代问台账 raw 截断 400 字为系统行为，已如实标注
