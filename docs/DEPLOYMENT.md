# النشر (Deployment)

تعمل بيئة الإنتاج على مضيف Docker واحد باستخدام الملف:

`infra/docker-compose.prod.yml`

يعمل البوت من خلال صورة Docker واحدة. يقوم ملف `Dockerfile` ببنائه باستخدام الأمر:

`bun build --compile`

وينتج عن ذلك ملف تنفيذي واحد (Binary) يتولى المهام التالية:

- تنفيذ ترحيلات قاعدة البيانات.
- الاتصال بـ Discord.
- نشر أوامر Slash.

تعمل الخدمات التالية بجانبه كخدمات منفصلة:

- PostgreSQL 18.
- Redis 8.
- Lavalink 4.2.2.
- yt-cipher.

تكون الموسيقى مفعّلة دائمًا في بيئة الإنتاج.

لا يتم نشر أي خدمة على الشبكة العامة باستثناء نقطة فحص الحالة (Health Endpoint)، والتي يقوم Docker Compose دائمًا بربطها بالعنوان:

`127.0.0.1:<HEALTH_PUBLISH_PORT>`

المنفذ الافتراضي هو `8080` على المضيف، ولا يتم ربطها أبدًا بعنوان عام.

تتواصل الخدمات مع بعضها باستخدام أسمائها، ويقوم Docker Compose بإنشاء القيم التالية:

- `DATABASE_URL`
- `REDIS_URL`
- `LAVALINK_URL`

وذلك اعتمادًا على كلمات المرور الموجودة في ملف `.env`.

تعمل PostgreSQL وRedis ضمن شبكة داخلية لا تملك مسارًا للاتصال بالإنترنت.

أما Lavalink وyt-cipher فيعملان ضمن شبكة أخرى لديها اتصال بالإنترنت.

يكون البوت متصلًا بالشبكتين، ويصل إلى Discord من خلال الشبكة الثانية.

يتم تثبيت صور PostgreSQL وRedis وLavalink باستخدام بصمة الصورة (Digest)، كما يعمل Lavalink وyt-cipher بوضع القراءة فقط (Read-only)، مع تعطيل جميع إمكانيات النظام الإضافية.

يقرأ Redis كلمة المرور من ملف إعدادات موجود داخل نظام ملفات مؤقت (tmpfs)، لذلك لا تظهر كلمة المرور في:

- قائمة العمليات `ps`.
- الأمر `docker inspect`.

يتم تحديد إصدار البوت المنشور باستخدام رقم الـ Commit الموجود في المستودع على الخادم.

عند كل عملية تشغيل، يتم بناء الصورة من نسخة المستودع الموجودة على الخادم، ويتم تسميتها بالشكل التالي:

`dzajcarz-bot:<short commit>`

وبذلك يمكنك معرفة رقم الـ Commit الذي يعمل عليه البوت باستخدام `docker ps`.

كما يتم تخزين رقم الـ Commit داخل الصورة في الوسم:

`org.opencontainers.image.revision`

---

## الأوامر على الخادم (Commands on the host)

تحتاج سكربتات:

`bun run prod:*`

إلى وجود Bun على الخادم.

إذا لم يكن Bun مثبتًا، يمكنك تعريف دالة Shell التالية مرة واحدة، مثلًا داخل الملف:

`~/.bashrc`

ثم استخدامها بدلًا من السكربتات. فهي تنفذ الوظيفة نفسها:

```bash
prod() {
  BOT_REVISION=$(git rev-parse --short HEAD) \
    docker compose --env-file .env -f infra/docker-compose.prod.yml "$@"
}
```

### مقارنة الأوامر

| مع Bun | بدون Bun |
|---|---|
| `bun run prod:up` | `prod up -d --build` |
| `bun run prod:down` | `prod down` |
| `bun run prod:logs` | `prod logs -f bot` |
| لا يوجد | `prod ps` و`prod exec` وغيرها |

نفّذ هذه الأوامر من المجلد الرئيسي للمستودع (Repository Root).

يرفض Docker Compose بدء التشغيل إذا لم يجد المتغير:

`BOT_REVISION`

وهذا يمنع تشغيل صورة لا تتوافق مع نسخة الكود الموجودة حاليًا في المستودع عند استخدام أمر `docker compose up` العادي.

---

## قبل أول عملية نشر (Before the first deploy)

من خلال [بوابة مطوري Discord](https://discord.com/developers/applications)، افتح صفحة التطبيق ثم صفحة **Bot**، وقم بتفعيل الخيارين التاليين:

- **Message Content Intent**
- **Server Members Intent**

بدون تفعيلهما، لن تعمل أوامر Prefix ورسائل الترحيب بشكل صحيح.

راجع قسم Getting Started في ملف `README.md`.

### متطلبات الخادم

يحتاج الخادم إلى:

- Docker مع إضافة Compose.
- Bun، أو دالة `prod` الموضحة سابقًا.
- Git.
- نسخة من هذا المستودع.

يتم بناء صورة البوت من المستودع نفسه، كما يقوم Lavalink بتحميل ملف الإعدادات:

`infra/lavalink/application.yml`

والأغاني المجدولة الموجودة داخل:

`infra/lavalink/music`

### خطوات التثبيت والتشغيل

```bash
git clone git@github.com:LordPrinz/dzajcarz-pro.git dzajcarz && cd dzajcarz

# الفرع الافتراضي هو main

cp .env.example .env && chmod 600 .env

# أدخل القيم التالية:
# DISCORD_TOKEN
# DISCORD_CLIENT_ID
# كلمات المرور الثلاث

# يمكنك إنشاء كل كلمة مرور باستخدام:
# openssl rand -hex 32

bun run prod:up
```

تستخدم بيئة الإنتاج ملف `.env` نفسه المستخدم في التطوير المحلي، لكنها تقرأ فقط القيم التي يحتاج إليها البوت على الخادم:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- كلمات المرور الثلاث.
- `BOT_PREFIX`
- `RIOT_VALORANT_API_KEY`
- `RIOT_LOL_API_KEY`
- `LOG_LEVEL`
- إعدادات الأغاني المجدولة.
- `HEALTH_PUBLISH_PORT`

يقوم Docker Compose بتمرير كل قيمة إلى البوت باستخدام اسم المتغير نفسه.

أما المتغيرات التالية فلا تصل إلى حاوية الإنتاج:

- `DATABASE_URL`
- `REDIS_URL`
- `LAVALINK_URL`
- `DISCORD_DEV_GUILD_ID`
- `DISCORD_DEV_TOKEN`
- `DISCORD_DEV_CLIENT_ID`
- جميع روابط `TEST_*` الموجودة في الملف.

إذا لم يتم تحديد سيرفر تطوير باستخدام `DISCORD_DEV_GUILD_ID`، يقوم البوت بنشر أوامر Slash عالميًا.

تعمل بيئة الإنتاج كمشروع Docker Compose منفصل، مع وحدات تخزين خاصة بها (Volumes)، لذلك لا تشارك البيانات مع:

`bun run infra:up`

### كلمات المرور

يتم تضمين كلمات المرور داخل:

- `DATABASE_URL`
- `REDIS_URL`

يرفض البوت بدء التشغيل إذا كانت كلمة المرور تحتوي على رموز تكسر صيغة الرابط، مثل:

- `@`
- `/`
- `?`
- `#`

إذا لم يتم ترميز هذه الرموز بشكل صحيح.

لذلك يُنصح باستخدام كلمات مرور Hex.

عند أول تشغيل، تقوم خدمة:

`lavalink-plugins-init`

بتنزيل إضافة YouTube، ولذلك قد يستغرق تشغيل الموسيقى دقيقة تقريبًا.

تتحقق الخدمة من ملف الإضافة باستخدام البصمة الموجودة في:

`infra/lavalink/youtube-plugin.sha256`

إذا لم تتطابق البصمة، يتم إيقاف بيئة التشغيل قبل بدء Lavalink.

راجع [ADR 4](adr/0004-lavalink-for-audio.md#youtube-setup-dzaj-50).

لمعرفة سبب المشكلة، استخدم:

```bash
prod logs lavalink-plugins-init
```

### تغيير كلمة مرور PostgreSQL

تأخذ القيمة:

`POSTGRES_PASSWORD`

مفعولها فقط عند إنشاء وحدة التخزين `postgres-data` لأول مرة.

إذا أردت تغيير كلمة المرور لاحقًا، اتبع هذا الترتيب:

1. غيّر كلمة المرور داخل قاعدة البيانات أولًا.
2. غيّرها داخل ملف `.env`.
3. نفّذ أمر تشغيل الإنتاج.

لتغييرها داخل قاعدة البيانات:

```bash
prod exec postgres psql -U dzajcarz -c "ALTER USER dzajcarz PASSWORD '<new hex password>'"
```

استبدل `<new hex password>` بكلمة المرور الجديدة.

---

## إصدار جديد (Release)

لنشر إصدار جديد:

```bash
git pull

# أو يمكنك الانتقال إلى Tag أو Commit معين:
# git checkout <tag or commit>

# إذا كان الإصدار يتضمن Migration جديدة:
# أنشئ نسخة احتياطية أولًا (راجع قسم Backups)،
# لأن البوت ينفذ الترحيلات أثناء بدء التشغيل.

bun run prod:up
```

يقوم الأمر ببناء صورة الإصدار الموجود حاليًا في المستودع، ثم يعيد إنشاء الحاويات التي تغيرت إعداداتها أو صورها فقط.

يحصل البوت القديم على إشارة:

`SIGTERM`

ويُمنح 30 ثانية من أجل:

- مغادرة القنوات الصوتية.
- إغلاق الاتصالات والموارد المفتوحة.

بعد ذلك يبدأ البوت الجديد بتنفيذ الخطوات التالية:

1. **تطبيق ترحيلات قاعدة البيانات (Migrations):**

   يتم تنفيذ الترحيلات المعلقة باستخدام قفل استشاري من PostgreSQL (Advisory Lock)، مع الانتظار لمدة أقصاها 60 ثانية للحصول على القفل، وذلك قبل تسجيل الدخول إلى Discord.

   إذا فشلت عملية الترحيل، ينتهي البرنامج برمز خروج `1`، ولا يقوم البوت بتسجيل الدخول إلى Discord.

   تواصل سياسة إعادة التشغيل المحاولة، ويوضح سجل التشغيل سبب الفشل.

2. **تسجيل الدخول إلى Discord:**

   بعد نجاح الترحيلات، يقوم البوت بتسجيل الدخول.

3. **نشر أوامر Slash:**

   بعد أن تصبح بوابة Discord جاهزة، يقوم البوت بنشر أوامره عالميًا؛ لأن بيئة الإنتاج لا تستخدم المتغير:

   `DISCORD_DEV_GUILD_ID`

   لا يتم إرسال الأوامر إلا إذا كانت مجموعة الأوامر الموجودة لدى Discord مختلفة عن المجموعة الموجودة في الكود.

   قد يستغرق ظهور التغييرات في أوامر Slash العالمية بعض الوقت.

لا تحتاج إلى تنفيذ:

`bun run commands:deploy`

في بيئة الإنتاج.

### التحقق من الإصدار المنشور

استخدم الأوامر التالية:

```bash
bun run prod:logs

# أو:
prod logs -f bot
```

لفحص حالة البوت:

```bash
curl -s http://127.0.0.1:8080/health
```

من المفترض أن تحصل على استجابة مشابهة:

```json
{
  "ok": true,
  "checks": {
    "gateway": true,
    "postgres": true,
    "redis": true
  }
}
```

لمعرفة إصدار الصورة وحالة الحاوية:

```bash
docker ps --filter name=dzajcarz-prod-bot
```

يجب أن يظهر اسم صورة مثل:

`dzajcarz-bot:<commit>`

وتكون الحالة:

`healthy`

### ترتيب السجلات عند التشغيل الناجح

يتم تسجيل كل حدث في سطر JSON مستقل.

الترتيب الطبيعي للأحداث هو:

1. `Applied migrations` أو `Database is up to date`
2. `Logged in`
3. `Deployed slash commands` أو `Slash commands are up to date`

يقوم فحص صحة Docker بتنفيذ:

`bot healthcheck`

ويتحقق من نقطة:

`/health`

إذا تعطلت بوابة Discord أو PostgreSQL أو Redis، تظهر حالة الحاوية في `docker ps` على أنها:

`unhealthy`

راجع قسم Health Endpoint داخل `DESIGN.md` لمعرفة تفاصيل الفحوصات.

### التراجع إلى إصدار سابق (Rollback)

إذا ظهرت مشكلة في الإصدار الجديد، يمكنك الرجوع إلى الإصدار السابق باستخدام:

```bash
git checkout <previous tag or commit>

bun run prod:up
```

تبقى صورة Docker القديمة موجودة، لذلك ستكون عملية البناء في معظمها معتمدة على الملفات المخزنة مؤقتًا (Cache).

**ملاحظة مهمة حول الترحيلات:**

الترحيلات تعمل باتجاه واحد فقط (Forward-only).

يتجاهل الإصدار القديم الجداول والأعمدة التي لا يعرفها.

لكن إذا احتوى الإصدار الجديد على ترحيل حذف أو غيّر شيئًا ما زال الكود القديم يستخدمه، فلن يكون الرجوع بهذه الطريقة آمنًا.

في هذه الحالة يجب استعادة النسخة الاحتياطية التي تم إنشاؤها قبل الإصدار.

قبل تنفيذ عملية `git pull` التالية، ارجع إلى الفرع الرئيسي:

```bash
git checkout main
```

### الصور القديمة (Old images)

يترك كل إصدار صورة Docker الخاصة به بعد النشر.

يمكن حذف صور البوت القديمة التي لا تستخدمها أي حاوية والتي تجاوز عمرها شهرًا باستخدام:

```bash
docker image prune -a --filter "label=org.opencontainers.image.title=dzajcarz-bot" --filter "until=720h"
```

### ترقية PostgreSQL من الإصدار 17 إلى 18

يحتفظ الإصدار 18 ببياناته داخل مجلد فرعي يحمل رقم الإصدار.

لذلك يتم ربط وحدة التخزين بالمسار:

`/var/lib/postgresql`

ويرفض PostgreSQL 18 استخدام وحدة تخزين تحتوي على بيانات عنقود PostgreSQL 17.

يجب أخذ نسخة احتياطية باستخدام حاوية PostgreSQL 17، ثم استعادة البيانات داخل وحدة تخزين جديدة.

نفّذ الخطوات التالية:

```bash
prod stop bot postgres

docker run -d --name pg17 -v dzajcarz-prod_postgres-data:/var/lib/postgresql/data postgres:17-alpine

docker exec pg17 pg_dumpall -U dzajcarz > pg17.sql && docker rm -f pg17

docker volume create dzajcarz-prod_postgres-data-pg17-backup

# انسخ وحدة التخزين القديمة إلى وحدة التخزين الاحتياطية الجديدة.

docker volume rm dzajcarz-prod_postgres-data

prod up -d postgres

docker exec -i dzajcarz-prod-postgres-1 psql -U dzajcarz -d postgres < pg17.sql
```

قد تظهر أخطاء مثل:

`already exists`

وهذه الأخطاء متوقعة أثناء الاستعادة.

احتفظ بوحدة التخزين الاحتياطية وبالملف:

`pg17.sql`

حتى يعمل البوت بصورة سليمة لمدة يوم كامل على الأقل.

---

## النسخ الاحتياطية (Backups)

تحتوي PostgreSQL على جميع البيانات المهمة التي يجب الحفاظ عليها، مثل:

- إعدادات السيرفرات.
- مناطق الحفلات الصوتية.
- سجل إجراءات الإشراف والعقوبات.

أما Redis فيحتوي فقط على بيانات مؤقتة يمكن فقدانها.

يجب إنشاء نسخة احتياطية قبل كل إصدار يتضمن Migration جديدة، وكذلك بصورة دورية وفق جدول زمني.

تستخدم الأوامر التالية دالة `prod` الموضحة في قسم Commands on the host.

### إنشاء نسخة احتياطية

```bash
prod exec -T postgres pg_dump -U dzajcarz -Fc dzajcarz > dzajcarz-$(date +%F).dump
```

يتم إنشاء ملف باسم يتضمن تاريخ اليوم.

### استعادة نسخة احتياطية

يجب إيقاف البوت أولًا حتى لا تتم كتابة أي بيانات أثناء عملية الاستعادة.

```bash
prod stop bot

prod exec -T postgres pg_restore -U dzajcarz -d dzajcarz --clean --if-exists < dzajcarz-2026-01-31.dump

prod start bot
```

توجد البيانات داخل وحدة التخزين:

`dzajcarz-prod_postgres-data`

الأمر:

`prod:down`

لا يحذف بيانات وحدة التخزين.

أما الأمر:

`down -v`

فيحذف وحدات التخزين، وبالتالي يحذف البيانات الموجودة بداخلها.

**انتبه: لا تستخدم `down -v` إذا كنت تريد الاحتفاظ ببيانات قاعدة البيانات.**

---

## السجلات ومساحة القرص (Logs and disk)

تستخدم جميع الخدمات مشغل السجلات الخاص بـ Docker:

`json-file`

ويتم تحديد حجم السجلات بخمسة ملفات، حجم كل ملف 10 ميغابايت.

وهذا يمنع السجلات من استهلاك مساحة القرص بالكامل.

إذا أردت جعل البوت يعرض معلومات أكثر تفصيلًا، غيّر قيمة:

`LOG_LEVEL`

داخل ملف `.env` إلى:

`debug`

ثم أعد تشغيل بيئة الإنتاج:

```bash
bun run prod:up
```

سيبدأ البوت بإظهار سجلات أكثر تفصيلًا، مما يساعدك على تتبع الأخطاء ومعرفة ما يحدث أثناء التشغيل.
