# دزاجكارز

بوت ديسكورد لمجموعة من الأصدقاء: موسيقى من YouTube ومصادر أخرى (Lavalink)، وقنوات صوتية للحفلات تُنشأ عند الطلب، والإشراف، ورسائل الترحيب، وبعض النكات الجارية. يعمل كل أمر باستخدام أمر الشرطة المائلة (`/ping`) أو البادئة (`!ping`، وتُضبط البادئة لكل خادم).

هذه هي النسخة الخامسة، وهي إعادة كتابة باستخدام Bun. يوجد تاريخ الإصدارات السابقة (v3 وv4) تحتها في الفرع `main`.

- **البنية والقرارات:** [docs/DESIGN.md](docs/DESIGN.md)
- **سير العمل والاتفاقيات:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **الإنتاج والإصدارات:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **الويكي:** يُنشأ من هذه المستندات عند كل دمج إلى `main` ([`wiki.yml`](.github/workflows/wiki.yml))؛ عدّل الملفات في هذا المستودع، وليس الويكي
- **لوحة العمل:** GitHub Projects → _Dzajcarz_ (خاصة)

## التقنيات

| الطبقة | التقنية |
| --- | --- |
| وقت التشغيل والأدوات | [Bun](https://bun.com) 1.4: مدير الحزم ومشغّل الاختبارات و`Bun.SQL` و`RedisClient` |
| ديسكورد | discord.js 14 |
| الموسيقى | Lavalink 4 مع إضافة مصدر YouTube |
| قاعدة البيانات | PostgreSQL 18 عبر `Bun.SQL` وترحيلات SQL عادية |
| الذاكرة المؤقتة وفترات الانتظار | Redis 8 عبر Bun `RedisClient` |
| التحقق | zod (البيئة، ثم مدخلات الأوامر من لوحة التحكم لاحقًا) |
| الجودة | Biome وTypeScript strict وGit hooks من Husky وGitHub Actions |

## بنية المستودع

```
apps/
  bot/              عملية البوت: جذر التركيب، ومحوّلات ديسكورد، ونشر أوامر الشرطة المائلة
packages/
  core/             نظام الوحدات: الأوامر (شرطة مائلة + بادئة)، والأحداث، والسجل، والموزّع
  db/               ترحيلات SQL، ومشغّل الترحيلات، والمستودعات (Bun.SQL)
  kv/               منفذ KeyValueStore مع محوّلات Redis والذاكرة
modules/
  general/          ping وhelp (قائمة تفاعلية: فئات وصفحات وروابط التثبيت)
  dzajco/           يجيب عن "ماذا" بأي لغة باستخدام صورة DŻAJCO المتحركة (dzajco show وset وreset)
  settings/         البادئة (set وreset وshow) والوحدات (list وdisable وenable)
  welcome/          الترحيب (set عبر نموذج وoff وtest)، ويرحب بالأعضاء الجدد
  fun/              czy_wiedziałeś وtime
  party/            party (create وedit عبر نموذج، وdelete وlock وunlock وlimit وrename وinvite وspecial invite مع رسالة ومرفق، وblock وhide وshow)، وقناة صوتية لكل عضو ينضم إلى منطقة الحفلة
  moderation/       ban وkick وtimeout وuntimeout وwarn وwarnings وpurge (يُحفظ كل إجراء مع سببه)
  schedule/         schedule (list وexclude وinclude وsong)، يشغّل "Lato z Radiem" الساعة 09:00 و21:00 في أكثر قناة صوتية ازدحامًا
  messages/         messages (add عبر نموذج وlist وremove) وdm (on وoff): رسائل مجدولة للقنوات أو للرسائل الخاصة بالأعضاء في وقت محدد
  status/           يبدّل حالة نشاط البوت (أغنية البوت القديم)
  music/            play (p) وsearch وqueue وskip وstop وpause وresume وnowplaying (np) وloop وshuffle وseek وvolume وfilter وremove وjump وback وclear وsave (sv)، ولوحة تشغيل حالية بأزرار
  riot/             valorant وlol (إحصاءات اللاعبين من Riot API، وتتطلب RIOT_VALORANT_API_KEY / RIOT_LOL_API_KEY)
infra/              ملفات docker-compose: التطوير (Postgres وRedis وLavalink وyt-cipher في ملف تعريف "music") والإنتاج (docker-compose.prod.yml)
Dockerfile          البوت مجمّعًا في ملف ثنائي واحد (docs/DEPLOYMENT.md)
scripts/            Git hooks وأتمتة GitHub (برامج Bun)
docs/               مستند التصميم وADRs
```

## البدء

المتطلبات: Bun ≥ 1.4.4 وDocker وتطبيق ديسكورد مع مستخدم بوت ([بوابة المطورين](https://discord.com/developers/applications)). في البوابة، فعّل صلاحية **Message Content**، وإلا فلن ترى أوامر البادئة أي رسائل، وفعّل صلاحية **Server Members**، وإلا فلن تُرسل رسائل الترحيب (لأن البوت لن يستقبل انضمام الأعضاء).

```bash
bun install                       # يثبت أيضًا Git hooks
cp .env.example .env              # املأ DISCORD_DEV_TOKEN + DISCORD_DEV_CLIENT_ID (بوت الاختبار) أو DISCORD_TOKEN + DISCORD_CLIENT_ID، وDISCORD_DEV_GUILD_ID
bun run infra:up                  # Postgres على :5432 وRedis على :6379
bun run dev                       # البوت مع إعادة التشغيل عند تغيّر الملفات؛ ينفّذ الترحيلات ويسجّل أوامر الشرطة المائلة
```

تحتاج وحدة الحفلة إلى الصلاحيات التالية للبوت في الخادم: **Manage Channels** (إنشاء القنوات وإعادة تسميتها وحذفها)، و**Move Members** (وضع العضو في قناته وفصل العضو المحظور)، و**Manage Roles** (يعدّل البوت صلاحيات قنوات الحفلات؛ وبدونها تُنشأ قناة الحفلة، لكن لا يستطيع مالكها قفلها أو إخفاءها بأمان). قناة الأوامر هي الدردشة النصية لقناة الانضمام، ويحتاج البوت فيها إلى **Send Messages** و**Embed Links** (للوحة)، و**Read Message History** (للعثور على البقايا عند التشغيل) و**Manage Messages**. مع Manage Messages يحذف البوت الرسائل هناك بعد 15 ثانية؛ وبدونها تظل اللوحة تعمل، لكن لا تُنظّف الدردشة.

تحتاج وحدة الموسيقى إلى Lavalink أيضًا:
`docker compose --env-file .env -f infra/docker-compose.yml --profile music up -d` (على المنفذ 2333)، مع ضبط `LAVALINK_URL` و`LAVALINK_PASSWORD` في `.env`. يشغّل ملف التعريف أيضًا yt-cipher، الذي يفك تواقيع بث YouTube من أجل Lavalink (ADR 4). القيمتان اختياريتان: عند غيابهما، أو أثناء توقف العقدة، يعمل البوت طبيعيًا وتجيب أوامر الموسيقى بأن المشغّل غير متاح. في القناة الصوتية يحتاج البوت إلى **Connect** و**Speak**، وإلى **Send Messages** و**Embed Links** في القناة النصية التي بدأت منها الموسيقى (لوحة التشغيل الحالية).

تشغّل وحدة الجدولة الأغاني الموجودة في `infra/lavalink/music` عبر مصدر Lavalink المحلي `local` (ADR 4)، لذلك يحتاج Lavalink إلى تركيب ذلك المجلد: بعد سحب هذا التغيير أعد إنشاء الحاوية باستخدام:
`docker compose --env-file .env -f infra/docker-compose.yml --profile music up -d --force-recreate lavalink`.
في الساعة 09:00 و21:00 بتوقيت وارسو، ينضم البوت إلى القناة الصوتية التي تضم أكبر عدد من الأشخاص في كل خادم، ما لم تكن الموسيقى تعمل فيها مسبقًا. تدير الخوادم ذلك باستخدام `/schedule` (Manage Server)، أو توقفه باستخدام `/modules disable schedule`. تغيّر `SCHEDULED_SONG_CRON` و`SCHEDULED_SONG_TIMEZONE` وقت التشغيل.

مفتاحا `RIOT_VALORANT_API_KEY` و`RIOT_LOL_API_KEY` اختياريان ومستقلان: تصدر Riot مفتاحًا لكل لعبة. عند غياب المفتاح، يجيب الأمر الخاص به (`/valorant` أو `/lol`) بأن الإحصاءات متوقفة، بينما يستمر الآخر بالعمل. يكفي مفتاح تطوير من [بوابة مطوري Riot](https://developer.riotgames.com) للأمر `/lol`؛ أما سجل مباريات Valorant فيحتاج إلى مفتاح إنتاج (ADR 8).

## الأوامر البرمجية

| الأمر | وظيفته |
| --- | --- |
| `bun run dev` | البوت في وضع المراقبة |
| `bun run start` | البوت دون وضع المراقبة |
| `bun run commands:deploy` | تسجيل أوامر الشرطة المائلة دون تشغيل البوت (اختياري: ينفذ البوت ذلك عند التشغيل) |
| `bun run check` / `check:fix` | فحص Biome والتنسيق |
| `bun run typecheck` | تشغيل `tsc` للبرامج ولكل مساحة عمل |
| `bun test` | جميع الاختبارات (تحتاج اختبارات DB / Redis إلى `TEST_DATABASE_URL` / `TEST_REDIS_URL`) |
| `bun run db:new <name>` | ترحيل فارغ جديد `packages/db/migrations/NNNN_<name>.sql`؛ أدرجه في `packages/db/src/migrations.ts` |
| `bun run db:migrate` | تطبيق الترحيلات دون تشغيل البوت (اختياري: ينفذ البوت ذلك عند التشغيل) |
| `bun run infra:up` / `down` | تشغيل الخدمات المحلية أو إيقافها |
| `bun run prod:up` / `down` | بناء النسخة الحالية وتشغيل الإنتاج، أو إيقافه ([النشر](docs/DEPLOYMENT.md)) |
| `bun run prod:logs` | متابعة سجل بوت الإنتاج |
