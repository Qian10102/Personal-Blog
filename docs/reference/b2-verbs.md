# 法语 B2 专题词库

核对日期：2026-10-24。现有 100 个词条全部保留，新增 42 个，共 142 个。

本专题覆盖所选两篇公开教学资源明确列举的 **43 个动词／动词表达的并集**；其中 penser 已在原词库。范围侧重论证与观点转述，不能据此宣称涵盖所有 B2 词汇。[CEFR](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors) 描述语言能力，不规定唯一、穷尽的 B2 动词表。

## 选词来源

- [Parlez-vous French：20 verbes pour argumenter au DELF B2](https://parlez-vous-french.com/verbes-pour-argumenter-en-francais-b2/)：采用其编号的全部 20 个词条。
- [Commun français：Les verbes pour rapporter un point de vue](https://communfrancais.com/2019/01/25/les-verbes-pour-rapporter-un-point-de-vue/)：采用其主列表、同义词活动及补充五动词中明确列举的 26 个不同词条／表达。

逐词来源保存在 `src/data/b2-verb-sources.ts`。取词条并集，不抓取例句或整段定义；中文简明常用义由项目自行编写。`adhérer à` 以原形 `adhérer` 收录；弯引号统一为 ASCII 撇号。保留 `se prononcer`、`s'étonner`、`se moquer`、`se plaindre` 等代词式，以及 `être persuadé`、`être convaincu`、`faire remarquer` 三个完整表达。

## 变位与作答约定

所有新增词条均覆盖六个时态、六个人称，沿用原项目的词干与词尾规则。代词式答案包含自反代词，如 `me prononce`、`nous sommes prononcés`；主语和 `que` 不输入。代词式复合过去时使用 être。人称按阳性单数／复数处理，être + 形容词表达也按此配合。

重点交叉核对参考：[contredire](https://leconjugueur.lefigaro.fr/conjugaison/verbe/contredire.html)、[craindre](https://leconjugueur.lefigaro.fr/conjugaison/verbe/craindre.html)、[adhérer](https://leconjugueur.lefigaro.fr/conjugaison/verbe/adherer.html)。特别保留 `vous contredisez`、`nous craignons`、`j'adhère` 等形式。判题延续忽略重音差异的规则。

## 一致性验证

- 前端来源并集、完整变位、无重复及中文释义由单元测试核对。
- 数据库 `private.french_practice_verbs` 保存相同的 142 个原形，作为新作答、旧接口和重评重放的统一白名单。
- `tests/sql/b2-verbs.sql` 逐一检查全部词条的变位与释义保存、B2 重评和未知动词拒绝，最后回滚。
