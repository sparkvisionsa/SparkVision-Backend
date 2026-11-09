# تشغيل تسجيل الشاشة ومعالجته

## ما تغيّر

- يرسل المتصفح أجزاء التسجيل مباشرة إلى Spaces عبر Multipart موقّع. حجم الجزء 8 MiB؛ الأجزاء غير الأخيرة أكبر من الحد الأدنى لـS3 البالغ 5 MiB.
- ينشئ Nest جلسة الرفع بعد التحقق من الجلسة والمالك، ويصدر رابطًا موقّعًا قصير الصلاحية لكل جزء. لا يمر محتوى الفيديو عبر Next أو Nest.
- بعد الرفع يضع Nest مهمة BullMQ في Redis. العامل يحوّل المصدر إلى MP4، وينشئ بث HLS بثلاث درجات (720p/480p/360p) وصورة JPG، ثم يحذف الخام بعد نجاح جميع المخرجات.
- سجل MongoDB يمر بالحالات `uploading → processing → ready` أو `failed`. بيانات التسجيلات القديمة التي ما زالت في GridFS تبقى قابلة للعرض والتنزيل.
- التشغيل والتنزيل يطلبان تحقق صلاحية المالك في Nest. تنزيل الملف المعالج يستخدم اسم التسجيل مع رابط Spaces موقّع، والمشغل يستخدم HLS.js أو HLS الأصلي في Safari مع رجوع إلى MP4.

## التشغيل المحلي

1. أبقِ قيم Spaces الحالية في `.env`، واجعل الـ bucket خاصًا، وأضف المتغيرات الجديدة من `.env.example`. لا تنسخ مفاتيح الوصول إلى الواجهة.
2. شغّل Redis. مثال Docker:

   ```powershell
   docker run -d --name spark-recordings-redis -p 6379:6379 redis:7-alpine
   ```

   واجعل `REDIS_URL=redis://localhost:6379`.
   على Windows دون Docker يمكن تثبيت Redis محليًا للتطوير، ثم تشغيله في نافذة مستقلة:

   ```powershell
   winget install --id taizod1024.redis-windows-fork --exact --scope user
   $dataDir = Join-Path $env:LOCALAPPDATA 'spark-vision\redis'
   New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
   redis-server --bind 127.0.0.1 --port 6379 --appendonly yes --dir $dataDir
   ```

   استخدم Redis على Linux أو Docker في الإنتاج.
3. ثبّت FFmpeg وFFprobe محليًا وأضف مجلد `bin` إلى `PATH` (Windows: `winget install --id Gyan.FFmpeg.Shared --exact`). صورة Backend في Docker تثبّتهما تلقائيًا.
4. شغّل الـ API كالمعتاد، ثم شغّل العامل في نافذة منفصلة:

   ```powershell
   npm run worker:recordings:dev
   ```

   في الإنتاج يشغّل خادم API عامل التسجيلات داخله افتراضيًا، ولذلك تعمل الحاوية الواحدة دون خدمة إضافية. اجعل متغيرات Mongo وRedis وSpaces وFFmpeg متاحة للعملية، وابدأ بـ `RECORDING_WORKER_CONCURRENCY=1` و`RECORDING_FFMPEG_THREADS=2`. عند تشغيل خدمة عامل مستقلة بـ `npm run worker:recordings` اضبط `RECORDING_WORKER_EMBEDDED=false` في خدمة API فقط لتجنب مضاعفة التزامن. عند بدء العامل يعيد تلقائيًا إدراج التسجيلات التي بقيت في حالة `processing`. يولّد العامل MP4 مرة واحدة ثم يقسّمه إلى HLS دون إعادة ترميز، لتقليل زمن التجهيز. يمكن معاينة الملف الخام بعد اكتمال الرفع وأثناء المعالجة.

## إعداد CORS في Spaces

بدّل `https://app.example.com` بعنوان الواجهة الفعلي، ثم طبّق CORS على الـ bucket. يلزم عرض `ETag` للمتصفح كي يرسل قائمة الأجزاء إلى Nest عند الإكمال:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://app.example.com", "http://localhost:3000"],
      "AllowedMethods": ["GET", "HEAD", "PUT"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

استخدم AWS CLI مع endpoint الخاص بمنطقتك:

```powershell
aws s3api put-bucket-cors --endpoint-url https://sfo3.digitaloceanspaces.com --bucket YOUR_BUCKET --cors-configuration file://cors.json
```

يمكن تطبيق CORS وقاعدة إلغاء Multipart غير المكتمل مباشرةً من إعدادات `.env`، مع الحفاظ على قواعد Spaces الموجودة:

```powershell
node scripts/configure-screen-recording-spaces.cjs
node scripts/configure-screen-recording-spaces.cjs --apply
```

يستخدم السكربت origins من `CORS_ORIGINS` ويجعل إدراج ملفات الـ bucket خاصًا. ملفات التسجيل نفسها تُرفع بصلاحية `private`. أضف أصل الواجهة المنشورة إلى `CORS_ORIGINS` قبل تطبيق الإعداد في الإنتاج.

أضف origins الخاصة بالإنتاج فقط في النشر. لا تفعّل `Access-Control-Allow-Credentials` لطلبات Spaces؛ روابط الرفع والعرض موقّعة.

## CDN وCache-Control

فعّل Spaces CDN للـ bucket Standard، وضع عنوانه الافتراضي أو اسم النطاق المخصص في `DO_SPACES_CDN_ENDPOINT`، مثل `https://YOUR_BUCKET.sfo3.cdn.digitaloceanspaces.com`. يوقّع الخادم الطلب على origin ثم يبدل hostname حسب آلية Spaces للروابط الافتراضية. تبقى الملفات خاصة.

الـ playlists ترسل `application/vnd.apple.mpegurl` و`private, no-store`، ومقاطع HLS `video/mp2t`، وMP4 `video/mp4`، والصورة `image/jpeg`. روابط المقاطع الموقعة صلاحيتها الافتراضية ساعتان (تكفي تسجيلًا بطول ساعة مع بدء المشاهدة)، والتنزيل 5 دقائق.

**قيد مهم في Spaces:** طلبات GET الموقعة على CDN لا تُخزّن في edge cache؛ الـ CDN يحول الطلب إلى origin. لذلك تأتي مكاسب التحميل هنا من الرفع المباشر، وبداية التشغيل عبر مقاطع HLS القصيرة، وعدم تمرير الملف عبر خادم التطبيق. إذا كان المطلوب cache edge فعليًا مع bucket خاص، فستحتاج CDN يدعم token/signed cookies مع مسار حماية مناسب؛ لا تجعل مخرجات التسجيلات عامة لتجاوز ذلك. راجع [توجيه DigitalOcean لاستخدام الروابط الموقعة عبر CDN](https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/) و[ملاحظة التخزين المؤقت](https://docs.digitalocean.com/products/spaces/how-to/manage-cdn-cache/).

## Lifecycle وتكلفة التخزين

يوجد تنظيف Mongo دوري للجلسات المنتهية، ويعمل إلغاء Multipart من الخادم. أضف أيضًا قاعدة Spaces لإلغاء الأجزاء المتروكة بعد يوم:

```json
{
  "Rules": [
    {
      "ID": "abort-incomplete-screen-recordings",
      "Filter": { "Prefix": "helper-recordings/" },
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

```powershell
aws s3api put-bucket-lifecycle-configuration --endpoint-url https://sfo3.digitaloceanspaces.com --bucket YOUR_BUCKET --lifecycle-configuration file://lifecycle.json
```

للاحتفاظ المحدد، اضبط `RECORDING_RETENTION_DAYS` على عدد الأيام المعتمد؛ `0` يبقي التسجيلات دون حذف. عامل التنظيف سيحذف ملفات Mongo/GridFS وSpaces للحالات الجاهزة أو الفاشلة، وقاعدة Lifecycle اختيارية يمكن أن تحذف كائنات الـ prefix بعد المدة نفسها كشبكة أمان. لا تضف قاعدة انتهاء للكائنات قبل ضبط هذا المتغير على المدة نفسها حتى لا تبقى عناصر يتيمة في المكتبة. Spaces Lifecycle يدعم الإنهاء الزمني وإلغاء Multipart بحسب [الوثائق الرسمية](https://docs.digitalocean.com/products/spaces/how-to/configure-lifecycle-rules/).

## التحقق اليدوي

- تسجيل 20 ثانية، إيقاف طبيعي، التحقق من الاسم والحالة حتى `ready`، ثم تشغيل HLS وتنزيل MP4.
- تسجيل طويل يتجاوز 8 MiB للتحقق من وجود أكثر من جزء، ثم تجربة التقديم والتأخير وتغيير الجودة.
- قطع الإنترنت أثناء التسجيل وأثناء الرفع، ثم إعادته؛ يجب أن يكمل رفع الجزء الحالي ويستمر من الجزء التالي. إغلاق التبويب يوقف JavaScript؛ الأجزاء المكتملة تنظفها Lifecycle بعد يوم.
- مستخدم آخر لا يستطيع قراءة القائمة أو الحصول على روابط playlist أو thumbnail أو الملف.
- افتح تسجيلًا قديمًا في GridFS وتأكد من تشغيله وتنزيله.
- أوقف Redis ثم أعده؛ راقب حالة المعالجة ورسالة الخطأ في المكتبة وسجل العامل.

## الحدود الحالية

- أقصى مدة ساعة وحجم 1 GiB. الاستمرار بعد انقطاع الشبكة مدعوم داخل التبويب؛ استعادة تسجيل لم يكتمل بعد إغلاق التبويب تحتاج حفظ الأجزاء في IndexedDB وسير عمل استئناف بعد إعادة الدخول.
- المتصفح يحتفظ بقطع التسجيل حتى نهاية الالتقاط لإنشاء المعاينة المحلية؛ الرفع مباشر لكن تسجيلات ضخمة جدًا ما زالت تستهلك ذاكرة المتصفح. يمكن للمرحلة التالية جعل التخزين المحلي تدفقيًا وعرض معاينة الخادم فقط للتسجيلات الكبيرة.
- تحويل ثلاث درجات يستهلك CPU ومساحة إضافية مؤقتة. ارفع عدد العمال فقط بعد قياس موارد الخادم. CDN الموقّع لا يعطي cache hits في Spaces كما هو موضح أعلاه.
