# المساهمة

## الإعداد الأولي (مالك المستودع)

```bash
gh auth refresh -s project   # تحتاج واجهة Projects API إلى هذا النطاق الإضافي
bun run gh:setup             # إعدادات المستودع والتسميات والقواعد ثم لوحة المشروع
```

يطبع البرنامج الخطوات القليلة التي لا يسمح GitHub بتنفيذها إلا من المتصفح (طرق عرض اللوحة، وسير العمل المضمّن، وسر `PROJECTS_TOKEN`).

## لوحة العمل

`Backlog → Todo → In Progress → QA → Done`

| الحالة | معناها | كيف تصل إليها |
| --- | --- | --- |
| Backlog | لم تُخطط بعد | مشكلة جديدة (تلقائيًا) |
| Todo | مخططة للسباق الحالي | تخطيط السباق (يدوي) |
| In Progress | يعمل عليها أحدهم | دفع الفرع `DZAJ-<n>-…` (تلقائي) |
| QA | طلب سحب مفتوح: مراجعة الكود واختباره على خادم | فتح طلب السحب أو جعله جاهزًا للمراجعة (تلقائي) |
| Done | دُمجت في `main` | دمج طلب السحب (تلقائي) |

الحقول: **Area** و**Priority** (‏P0 يوقف الآخرين، وP1 لهذا السباق، وP2 من الجيد وجوده) و**Size** (‏S ≤ نصف يوم، وM من يوم إلى يومين، وL يُقسّم) و**Sprint** (أسبوعان).

كل مهمة هي مشكلة في GitHub. أنشئها من اللوحة باستخدام _+ Add item → Create new issue_، وليس كمسودة (فالمسودات لا تملك رقمًا).

## سير العمل

```bash
gh issue develop 12 --base main --name DZAJ-12-music-queue --checkout   # أو "Create a branch" من المشكلة
# …العمل…
git commit -m "feat(music): Add queue command"   # يحوّله hook إلى "[DZAJ-12] feat(music): Add queue command"
git push -u origin HEAD                           # pre-push: اسم الفرع وفحص النوع والاختبارات
gh pr create --base main --fill                    # يجب أن يتبع عنوان طلب السحب الصيغة نفسها
```

طوّر باستخدام بوت اختبار منفصل: أنشئ تطبيقًا ثانيًا في بوابة مطوري ديسكورد، وضع رمزه المميز ومعرّف التطبيق في `DISCORD_DEV_TOKEN` و`DISCORD_DEV_CLIENT_ID`. عند ضبط هاتين القيمتين، يستخدمهما `bun run dev` و`commands:deploy` بدلًا من `DISCORD_TOKEN` و`DISCORD_CLIENT_ID` الخاصين بالإنتاج، ويعرض سجل بدء التشغيل `app: "dev"`. لا يستقبل الإنتاج قيم الاختبار أبدًا.

اختبر الأوامر الجديدة على خادم اختبار خاص: اضبط `DISCORD_DEV_GUILD_ID` لتظهر أوامر الشرطة المائلة هناك فورًا بدلًا من انتظار النشر العام. يسجّلها البوت بنفسه عند التشغيل: يقرأ مجموعة أوامر ديسكورد ويرسل الأمر الجديد فقط عندما تختلف، ويكتب السجل "Deployed slash commands" أو "Slash commands are up to date". تعطل `COMMANDS_AUTO_DEPLOY=false` ذلك. أصبح `bun run commands:deploy` اختياريًا الآن؛ فهو ينفذ الشيء نفسه دون تشغيل البوت ويرسل المجموعة دائمًا.

لا يمكن استخدام أوامر الخادم في الرسائل الخاصة أو كتطبيق مثبّت للمستخدم. لتجربتها، انشرها عالميًا باستخدام `DEPLOY_GLOBAL=1 bun run commands:deploy`. عند تحديد خادم تطوير، يفرغ هذا أيضًا خادم التطوير حتى لا تظهر الأوامر مرتين (قد يستغرق النشر العام بعض الوقت). للعودة إلى وضع خادم التطوير، شغّل `DEPLOY_CLEAR=1 bun run commands:deploy` (يفرغ المجموعة العامة)، ثم شغّل `bun run commands:deploy` عاديًا.

تقبل القيمتان `1` أو `true`. يقرأ البوت `DEPLOY_GLOBAL` أيضًا: عند تشغيله معها، ينشر المجموعة العامة ويفرغ خادم التطوير بدلًا من تعبئته. في وضع خادم التطوير يترك البوت المجموعة العامة كما هي، ويكتب "Global commands duplicate the dev guild" عندما لا تكون فارغة، لأن خادم التطوير سيعرض كل أمر مرتين؛ شغّل `DEPLOY_CLEAR=1 bun run commands:deploy` لتفريغها. قبل إلغاء `DISCORD_DEV_GUILD_ID`، أفرغ خادم التطوير (`DEPLOY_GLOBAL=1 bun run commands:deploy` ينفذ ذلك)، وإلا فستبقى أوامره بجانب الأوامر العامة.

## تثبيت البوت

في بوابة مطوري ديسكورد، افتح التطبيق، ثم _Installation_:

- فعّل **User Install** و**Guild Install** معًا، واستخدم **Discord-provided link** كرابط التثبيت.
- النطاقات الافتراضية لتثبيت الخادم: `bot` و`applications.commands`.
- صلاحيات تثبيت الخادم: View Channels وSend Messages وEmbed Links وRead Message History وManage Messages وManage Channels وManage Roles وMove Members وConnect وSpeak وBan Members وKick Members وModerate Members وAdd Reactions.
- الصلاحيات الخاصة في صفحة _Bot_: Message Content وServer Members.

يضيف تثبيت المستخدم البوت إلى حساب الشخص: عندها يعمل `/help` و`/ping` في الرسائل الخاصة والرسائل الخاصة الجماعية والخوادم التي لا يكون البوت عضوًا فيها. في هذه الخوادم لا يستطيع البوت النشر في القناة، لذلك تكون الردود ردود تفاعل فقط.

## الاتفاقيات

- **الجذع** هو `main`. يحمل تاريخ البوت القديم (v3 وv4) تحت الكود الحالي.
- **التذكرة** `DZAJ-<n>` هي المشكلة `#<n>` (تُربط تلقائيًا في GitHub).
- **الفرع:** `DZAJ-<n>-short-kebab-description`.
- **عنوان الالتزام / طلب السحب:** `[DZAJ-<n>] <type>(<optional scope>): <Description>`
  - الأنواع: `feat` و`fix` و`chore` و`docs` و`refactor` و`test` و`perf` و`ci` و`build`
  - النطاقات: `core` و`bot` و`db` و`kv` و`general` و`settings` و`music` و`party` و`moderation` و`welcome` و`status` و`fun` و`infra`
  - تشير `!` بعد النوع أو النطاق إلى تغيير غير متوافق.
- تُدمج طلبات السحب باستخدام **squash**؛ ويصبح عنوان طلب السحب هو الالتزام في `main`.
- يحتفظ **Dependabot** بفروعه الخاصة `dependabot/…`؛ وتستخدم طلباته تذكرة التجميع DZAJ-3 (`[DZAJ-3] build(deps): Bump …`) وتمر بالفحوصات نفسها.
- الكود والتعليقات والمستندات والالتزامات باللغة الإنجليزية. وما يقوله البوت في ديسكورد باللغة العربية في هذه النسخة.

## إضافة وحدة ميزات

1. أنشئ `modules/<name>` مع ملف `package.json` اسمه `@dzajcarz/module-<name>` ويعتمد على `@dzajcarz/core`.
2. صدّر مصنعًا `create<Name>Module(deps)` يعيد `BotModule`. تسرد `deps` المنافذ التي تحتاجها الوحدة فقط (ADR 5)؛ ولا تقرأ الوحدة متغيرات البيئة ولا تنشئ العملاء بنفسها.
3. عرّف الأوامر باستخدام `defineCommand` ومعالجات الأحداث باستخدام `defineEvent`. ارمِ `UserError` لأي شيء يجب أن يقرأه المتصل؛ وتُسجّل الأخطاء الأخرى ويُستبدل بها رد عام. ضع حدًا لمعدل الأمر الذي يتصل بخدمة خارجية أو يغرق القناة باستخدام `cooldownMs`: يفرض الموزّع ذلك لكل مستخدم عبر الخوادم، وتتجاوز قيمة الأمر قيمة الأمر الفرعي.
4. أضف الوحدة إلى `apps/bot/src/modules.ts` ومرّر تبعياتها من `apps/bot/src/index.ts`.
5. اختبر الأوامر باستخدام `createFakeContext` من `@dzajcarz/core/testing`، دون ديسكورد.
6. حيث يُسمح بتشغيل الأمر (اختياري، ADR 7): `contexts: { places, installs }` في `defineCommand`. الأماكن هي `guild` و`bot-dm` و`private-channel`، وطرق التثبيت هي `guild` و`user`. بدون ذلك يكون الأمر مخصصًا للخادم فقط مع تثبيت الخادم. يحتاج `private-channel` إلى تثبيت `user`، وتحتاج `permissions` إلى أمر مخصص للخادم. لا تستخدم `channel.send` لأمر يمكن تشغيله في رسالة خاصة أو كتثبيت مستخدم؛ أرسل الرد عبر `ctx.reply`.
7. الأزرار وقوائم الاختيار (اختياري، ADR 6): ضع الصفوف ذات البيانات العادية في `ctx.reply({ components })`، وابنِ كل `custom_id` باستخدام `component.customId(ctx.user.id, state)`، وعرّف المعالجات باستخدام `defineButton` / `defineSelect` وأدرجها في `BotModule.components`. للتقسيم إلى صفحات استخدم `createPaginator`؛ وللحالة التي لا تتسع في 100 محرف استخدم `createComponentStateStore`. اختبر النقرات باستخدام `clickComponent({ registry, customId })` من `@dzajcarz/core/testing`.
8. النماذج (اختياري، ADR 6): عرّف نموذجًا باستخدام `defineModal` (حقول نص واختيار وقناة ومستخدم)، وأدرجه في `BotModule.modals` وافتحه باستخدام `ctx.showModal(modal.build(ctx.user.id, state))` من أمر شرطة مائلة أو معالج مكوّن. لا يمكن لأوامر البادئة فتحه: تحقق من `ctx.canShowModal` وحافظ على نموذج يعتمد على الوسائط. يجب أن تكون `showModal` أول إجابة (لا تستخدم `defer` قبلها، وحمّل القيم الافتراضية بسرعة). يُتحقق من الإرسال بصورة مستقلة، لذلك يجب أن يعلن النموذج المفتوح من أمر ذي صلاحيات عن `permissions` / `guildOnly` نفسيهما، كما أن `ctx.state` غير موثوق. اختبر باستخدام `ctx.modals` و`submitModal({ registry, customId, values, fromMessage? })` من `@dzajcarz/core/testing`.

## Git hooks (Husky)

| Hook | ما ينفذه |
| --- | --- |
| `prepare-commit-msg` | يضيف `[DZAJ-<n>]` من اسم الفرع |
| `commit-msg` | يتحقق من صيغة العنوان |
| `pre-commit` | يشغّل `biome check --staged --write` على الملفات المضافة إلى staging |
| `pre-push` | فحص اسم الفرع و`typecheck` و`bun test` |

يعيد CI كل الفحوصات، لذلك لا يؤدي `--no-verify` إلا إلى نقل الفشل إلى طلب السحب.

## تعريف الاكتمال

- استيفاء معايير القبول في المشكلة.
- تغطية التغيير بالاختبارات؛ ونجاح CI.
- نشر أوامر الشرطة المائلة إلى خادم الاختبار وتجربتها بالصيغتين (شرطة مائلة وبادئة).
- مراجعة موافقة واحدة.
- تحديث المستندات و`docs/DESIGN.md` إذا تغيّر قرار؛ وتحصل القرارات الأكبر على ADR في `docs/adr`.
