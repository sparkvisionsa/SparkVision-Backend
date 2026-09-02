import { config as loadEnv } from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import crypto from "node:crypto";

loadEnv({ path: ".env.local" });
loadEnv();

const COLLECTION = "asset description";
const LEGACY_COLLECTION = "وصف الاصل";
const SINGLETON_ID = new ObjectId("000000000000000000000001");

/**
 * المستوى الأول: category
 * المستوى الثاني: type
 * المستوى الثالث: name
 *
 * أُضيفت فئة «المركبات والمعدات المتحركة» من جدول الملخص، وتبقى أنواعها
 * الثلاثة وأسماؤها الستة فارغة حتى يصل جدول تفاصيلها غير الموجود في المرفقات.
 */
const CATALOG = [
  {
    category: "الأثاث المكتبي",
    types: [
      {
        type: "المكاتب",
        names: [
          "مكتب إداري (مدير)",
          "مكتب موظفين",
          "مكتب استقبال",
          "مكتب اجتماعات صغير",
        ],
      },
      {
        type: "محطات العمل",
        names: [
          "محطة عمل فردية (Workstation)",
          "محطة عمل جماعية بفواصل",
          "محطة عمل بفواصل زجاجية",
        ],
      },
      {
        type: "الكراسي المكتبية",
        names: [
          "كرسي مكتب إداري",
          "كرسي موظفين دوار",
          "كرسي زوار (بدون عجلات)",
          "كرسي اجتماعات",
        ],
      },
      {
        type: "الخزائن والأدراج",
        names: [
          "خزانة ملفات معدنية",
          "خزانة أرشيف خشبية",
          "وحدة أدراج (تحت المكتب)",
          "خزانة مستندات بقفل",
        ],
      },
      {
        type: "الكاونترات",
        names: ["كاونتر استقبال", "كاونتر بيع / كاشير"],
      },
      {
        type: "طاولات الاجتماعات",
        names: ["طاولة اجتماعات", "طاولة مؤتمر كبيرة", "طاولة تدريب قابلة للطي"],
      },
      {
        type: "الأرفف وخزائن العرض المكتبية",
        names: ["رفوف مكتبية معدنية", "خزانة عرض زجاجية مكتبية"],
      },
    ],
  },
  {
    category: "الأثاث المنزلي",
    types: [
      {
        type: "مجالس وصالات (كنب)",
        names: [
          "كنبة (أريكة) فردية",
          "طقم كنب (جلسة) 7 مقاعد",
          "كنبة زاوية",
          "طاولة وسط",
        ],
      },
      {
        type: "غرف النوم",
        names: [
          "سرير مفرد",
          "سرير مزدوج (كينج/كوين)",
          "دولاب ملابس",
          "تسريحة مع مرآة",
          "كومودينو",
        ],
      },
      {
        type: "غرف الطعام",
        names: ["طاولة سفرة", "كرسي سفرة", "بوفيه / نيش"],
      },
      {
        type: "أثاث المطابخ المنزلية",
        names: ["خزانة مطبخ علوية", "خزانة مطبخ سفلية", "حوض مطبخ مدمج"],
      },
      {
        type: "الكراسي والطاولات المنزلية العامة",
        names: ["كرسي استرخاء", "طاولة جانبية"],
      },
    ],
  },
  {
    category: "المفروشات والستائر",
    types: [
      {
        type: "السجاد والموكيت",
        names: ["سجاد يدوي / مفروش", "موكيت / أرضيات", "سجادة صلاة"],
      },
      {
        type: "الستائر",
        names: ["ستارة قماش عادية", "ستارة رول (Roller)", "ستارة بلاك آوت"],
      },
      {
        type: "الفرش والوسائد",
        names: ["مرتبة (فرشة سرير)", "وسادة", "لحاف / مفرش سرير"],
      },
    ],
  },
  {
    category: "الأجهزة الإلكترونية والمكتبية",
    types: [
      {
        type: "آلات التصوير والطباعة",
        names: [
          "آلة تصوير (ناسخة/فوتوكوبي) Canon",
          "طابعة HP",
          "طابعة ليزر متعددة الوظائف Ricoh",
        ],
      },
      {
        type: "الماسحات الضوئية",
        names: ["ماسح ضوئي Fujitsu fi-8190", "طابعة ملصق Epson"],
      },
      {
        type: "الهواتف والسنترالات",
        names: ["هاتف رقمي (سنترال) Panasonic", "هاتف مكتبي ثابت", "جهاز فاكس"],
      },
      {
        type: "قارئات الباركود والبطاقات",
        names: [
          "قارئ باركود Zebra TC57HO (Android/WWAN)",
          "قارئ بطاقات مغناطيسية",
        ],
      },
      {
        type: "الأجهزة اللوحية والإلكترونية الصغيرة",
        names: ["جهاز لوحي (تابلت)", "آلة حاسبة إلكترونية مكتبية"],
      },
    ],
  },
  {
    category: "أجهزة الحاسب الآلي والشبكات",
    types: [
      {
        type: "أجهزة الحاسب الآلي",
        names: ["حاسب آلي مكتبي Dell (Desktop)", "حاسب آلي محمول (لابتوب) HP"],
      },
      {
        type: "الشاشات",
        names: ["شاشة عرض كمبيوتر Dell/Samsung", "شاشة عرض تلفزيونية LED"],
      },
      {
        type: "أجهزة الشبكات",
        names: [
          "راوتر (موجه)",
          "مودم",
          "موزع شبكة (سويتش)",
          "نقطة وصول لاسلكية (Access Point)",
        ],
      },
      {
        type: "ملحقات الحاسب الآلي",
        names: [
          "طابعة شبكية",
          "لوحة مفاتيح وماوس",
          "وحدة تخزين خارجي (Server/NAS)",
        ],
      },
    ],
  },
  {
    category: "أنظمة الأمن والسلامة",
    types: [
      {
        type: "أجهزة الإنذار",
        names: ["جهاز إنذار مع حساس وبطارية داخلية", "لوحة تحكم بنظام الإنذار"],
      },
      {
        type: "كاميرات المراقبة",
        names: [
          "كاميرا مراقبة داخلية IP",
          "كاميرا مراقبة خارجية Hikvision",
          "جهاز تسجيل مراقبة (DVR/NVR)",
        ],
      },
      {
        type: "أجهزة التحكم بالدخول والحضور",
        names: [
          "جهاز بصمة (حضور وانصراف)",
          "قارئ بطاقات RFID للدخول",
          "بوابة أمنية (تورنستايل)",
        ],
      },
      {
        type: "أجهزة الإطفاء والسلامة",
        names: ["طفاية حريق", "نظام إنذار حريق مركزي", "كاشف دخان"],
      },
    ],
  },
  {
    category: "الأجهزة الطبية",
    types: [
      {
        type: "أجهزة الفحص والتشخيص",
        names: [
          "جهاز قياس ضغط الدم",
          "جهاز تخطيط القلب (ECG)",
          "جهاز موجات صوتية (Ultrasound)",
        ],
      },
      {
        type: "أجهزة التعقيم",
        names: ["جهاز تعقيم أوتوكلاف"],
      },
      {
        type: "الأثاث والمعدات الطبية",
        names: ["سرير طبي كهربائي", "عربة طبية متنقلة", "كرسي أسنان طبي"],
      },
      {
        type: "أجهزة العناية والطوارئ",
        names: ["جهاز إنعاش قلبي (Defibrillator)", "أسطوانة أكسجين طبي"],
      },
    ],
  },
  {
    category: "المعدات والآلات الثقيلة",
    types: [
      {
        type: "معدات الرفع والمناولة الثقيلة",
        names: ["رافعة شوكية (فورك ليفت)", "ونش رفع", "رافعة برجية"],
      },
      {
        type: "معدات الحفر والبناء",
        names: ["حفارة (Excavator)", "لودر (Loader)", "خلاطة خرسانة"],
      },
      {
        type: "آلات التشغيل الميكانيكي (ورش)",
        names: ["مخرطة معدنية (Lathe)", "ماكينة تفريز CNC", "مكبس هيدروليكي"],
      },
      {
        type: "معدات إسناد صناعية",
        names: ["مانع اهتزاز مع كامل الإكسسوارات", "قاعدة تثبيت مانعة للصدمات"],
      },
    ],
  },
  {
    category: "خطوط الإنتاج والمعدات الصناعية",
    types: [
      {
        type: "خطوط الإنتاج والتعبئة",
        names: ["خط إنتاج تعبئة وتغليف", "خط إنتاج بلاستيك (حقن/سحب)", "خط إنتاج غذائي"],
      },
      {
        type: "أجهزة القياس والفحص الصناعي",
        names: ["جهاز فحص جودة (Quality Control)", "ميزان صناعي إلكتروني"],
      },
      {
        type: "المضخات والضواغط الصناعية",
        names: ["مضخة مياه", "مضخة هيدروليكية", "ضاغط هواء (كومبريسور)"],
      },
      {
        type: "أفران ومعدات المعالجة الحرارية",
        names: ["فرن صناعي", "غرفة تبريد صناعية"],
      },
    ],
  },
  {
    category: "أنظمة التكييف والتبريد",
    types: [
      {
        type: "المكيفات السبليت والشباك",
        names: ["مكيف سبليت GREE 24 وحدة", "مكيف شباك"],
      },
      {
        type: "المكيفات الدولابية والباكج",
        names: ["مكيف دولابي (باكج) 46200 وحدة حرارية بارد"],
      },
      {
        type: "أنظمة التبريد المركزي",
        names: ["مبرد مياه مركزي (تشيلر)", "برج تبريد", "وحدة مناولة هواء (AHU)"],
      },
      {
        type: "التبريد التجاري",
        names: ["ثلاجة عرض تجارية", "فريزر تجاري", "غرفة تبريد (كولد ستور)"],
      },
    ],
  },
  {
    category: "المعدات الكهربائية ومصادر الطاقة",
    types: [
      {
        type: "المولدات",
        names: ["مولد كهربائي ديزل"],
      },
      {
        type: "أنظمة الطاقة والتوزيع",
        names: [
          "لوحة كهربائية رئيسية",
          "مزود طاقة لا انقطاعية (UPS)",
          "محول كهربائي (ترانسفورمر)",
        ],
      },
      {
        type: "الطاقة الشمسية",
        names: ["لوح شمسي (Solar Panel)", "عاكس طاقة شمسية (Inverter)"],
      },
    ],
  },
  {
    category: "معدات المطابخ والمغاسل التجارية",
    types: [
      {
        type: "الأحواض",
        names: ["حوض غسيل (مغسلة) ستانلس", "حوض مطبخ تجاري مزدوج"],
      },
      {
        type: "معدات الطهي التجارية",
        names: ["فرن تجاري", "موقد غاز صناعي", "شواية تجارية"],
      },
      {
        type: "معدات التبريد والحفظ التجارية",
        names: ["ثلاجة تجارية", "فريزر تجاري"],
      },
      {
        type: "معدات التنظيف والغسيل",
        names: ["ماكينة غسيل سجاد", "غسالة صناعية", "مكنسة كهربائية صناعية"],
      },
    ],
  },
  {
    category: "معدات النقل والمناولة",
    types: [
      {
        type: "عربات النقل اليدوية",
        names: ["عربة نقل يدوية", "ترولي بضائع"],
      },
      {
        type: "الرافعات والونش",
        names: ["رافعة شوكية", "ونش سقفي كهربائي"],
      },
      {
        type: "سيور ومعدات نقل داخلي",
        names: ["سير ناقل (Conveyor)"],
      },
    ],
  },
  {
    category: "التجهيزات والديكورات التجارية",
    types: [
      {
        type: "معارض ووحدات العرض",
        names: ["معرض مختلف الأحجام (قاعدة خشبية وألواح)", "واجهة عرض زجاجية"],
      },
      {
        type: "المظلات والهياكل الخارجية",
        names: ["مظلة قماش ألماني مع ماسورة 4 بوصة"],
      },
      {
        type: "اللافتات والدعاية",
        names: ["لافتة إعلانية مضيئة", "بانر / رول أب"],
      },
    ],
  },
  {
    category: "المركبات والمعدات المتحركة",
    types: [],
  },
  {
    category: "معدات الصوت والعرض (الوسائط)",
    types: [
      {
        type: "الميكروفونات",
        names: ["مايكروفون سلكي", "مايكروفون لاسلكي"],
      },
      {
        type: "مكبرات ومقويات الصوت",
        names: ["مقوي صوت (أمبليفاير)", "سماعة مكبر صوت"],
      },
      {
        type: "أجهزة العرض المرئي",
        names: ["جهاز عرض (بروجكتر)", "شاشة عرض تفاعلية (Smart Board)"],
      },
    ],
  },
  {
    category: "الأدوات والمعدات اليدوية",
    types: [
      {
        type: "أدوات الورش الكهربائية",
        names: ["مثقاب كهربائي", "منشار كهربائي", "صاروخ لحام"],
      },
      {
        type: "أدوات القياس والفحص اليدوية",
        names: ["شريط قياس", "ميزان حرارة رقمي", "جهاز فحص متعدد (ملتيميتر)"],
      },
    ],
  },
];

const normalize = (value) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");

const newId = () => crypto.randomBytes(12).toString("hex");

function validateCatalog() {
  const categoryCount = CATALOG.length;
  const typeCount = CATALOG.reduce((sum, category) => sum + category.types.length, 0);
  const nameCount = CATALOG.reduce(
    (sum, category) =>
      sum + category.types.reduce((typeSum, type) => typeSum + type.names.length, 0),
    0,
  );
  if (categoryCount !== 17 || typeCount !== 62 || nameCount !== 159) {
    throw new Error(
      `Seed validation failed: categories=${categoryCount}, types=${typeCount}, names=${nameCount}`,
    );
  }
  return { categoryCount, typeCount, nameCount };
}

function mergeCatalog(existing = {}) {
  const categories = Array.isArray(existing.categories) ? [...existing.categories] : [];
  const types = Array.isArray(existing.types) ? [...existing.types] : [];
  const names = Array.isArray(existing.names) ? [...existing.names] : [];
  const descriptions = Array.isArray(existing.descriptions) ? [...existing.descriptions] : [];

  const added = { categories: 0, types: 0, names: 0, descriptions: 0 };

  for (const seedCategory of CATALOG) {
    let category = categories.find(
      (item) => normalize(item?.label) === normalize(seedCategory.category),
    );
    if (!category) {
      category = { id: newId(), label: seedCategory.category };
      categories.push(category);
      added.categories += 1;
    }

    for (const seedType of seedCategory.types) {
      let type = types.find(
        (item) =>
          item?.categoryId === category.id &&
          normalize(item?.label) === normalize(seedType.type),
      );
      if (!type) {
        type = { id: newId(), categoryId: category.id, label: seedType.type };
        types.push(type);
        added.types += 1;
      }

      for (const seedName of seedType.names) {
        let name = names.find(
          (item) =>
            item?.typeId === type.id && normalize(item?.label) === normalize(seedName),
        );
        if (!name) {
          name = { id: newId(), typeId: type.id, label: seedName };
          names.push(name);
          added.names += 1;
        }

        const exists = descriptions.some(
          (item) =>
            item?.categoryId === category.id &&
            item?.typeId === type.id &&
            item?.nameId === name.id,
        );
        if (!exists) {
          descriptions.push({
            id: newId(),
            categoryId: category.id,
            typeId: type.id,
            nameId: name.id,
            category: category.label,
            type: type.label,
            name: name.label,
            mainImageUrl: null,
          });
          added.descriptions += 1;
        }
      }
    }
  }

  return {
    categories,
    types,
    names,
    descriptions: descriptions.map((item) => ({
      ...item,
      mainImageUrl:
        typeof item?.mainImageUrl === "string" && item.mainImageUrl.trim()
          ? item.mainImageUrl.trim()
          : null,
    })),
    added,
  };
}

async function run() {
  const counts = validateCatalog();
  const mongoUrl = process.env.MONGO_URL_SCRAPPING;
  const dbName = process.env.MONGO_DBNAME_SCRAPPING;
  if (!mongoUrl || !dbName) {
    throw new Error("Missing MONGO_URL_SCRAPPING or MONGO_DBNAME_SCRAPPING.");
  }

  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(COLLECTION);
    const legacyCollection = db.collection(LEGACY_COLLECTION);
    const [currentRows, legacyRows] = await Promise.all([
      collection.find({}).toArray(),
      legacyCollection.find({}).toArray(),
    ]);
    const source = [...currentRows, ...legacyRows].sort(
      (a, b) =>
        (Array.isArray(b?.descriptions) ? b.descriptions.length : 0) -
        (Array.isArray(a?.descriptions) ? a.descriptions.length : 0),
    )[0];
    const merged = mergeCatalog(source ?? {});
    const now = new Date();

    console.log(
      `Validated seed: ${counts.categoryCount} categories, ${counts.typeCount} types, ${counts.nameCount} descriptions.`,
    );

    await collection.replaceOne(
      { _id: SINGLETON_ID },
      {
        _id: SINGLETON_ID,
        categories: merged.categories,
        types: merged.types,
        names: merged.names,
        descriptions: merged.descriptions,
        createdAt: source?.createdAt instanceof Date ? source.createdAt : now,
        updatedAt: now,
      },
      { upsert: true },
    );
    const removedNewDuplicates = await collection.deleteMany({ _id: { $ne: SINGLETON_ID } });
    if (legacyRows.length > 0) {
      await legacyCollection.drop();
    }

    console.log(
      `Seeded singleton catalog: +${merged.added.categories} categories, ` +
        `+${merged.added.types} types, +${merged.added.names} names, ` +
        `+${merged.added.descriptions} descriptions. ` +
        `Removed ${removedNewDuplicates.deletedCount + legacyRows.length} duplicate documents.`,
    );
  } finally {
    await client.close();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
