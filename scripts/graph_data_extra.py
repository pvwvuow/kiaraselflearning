# -*- coding: utf-8 -*-
"""Kiara graph content — non-word nodes: chunks (20), grammar patterns (14),
pragmatic skills (11), fa→en error patterns (8), topic clusters (4).
Totals with seed.sample.json: 25 chunks / 20 grammar / 15 pragmatic / 12 error / 6 clusters.
"""

# ── chunks ──
CHUNKS = [
    {"id": "en:chunk:how-many", "cefr": "A1", "title": "How many…?", "gloss": "چندتا؟ (برای قابل‌شمارش)", "expl": "برای اسم قابل‌شمارش: How many bags? — غیرقابل‌شمارش با How much است.", "tags": ["shopping", "travel"], "ex": "How many bags do you have?"},
    {"id": "en:chunk:there-is-there-are", "cefr": "A1", "title": "There is / There are", "gloss": "هست، وجود دارد", "expl": "there is + مفرد، there are + جمع: There are two flights on Friday.", "tags": ["daily", "travel"], "ex": "There is a pharmacy near here."},
    {"id": "en:chunk:i-need", "cefr": "A1", "title": "I need…", "gloss": "احتیاج دارم", "expl": "need + اسم یا to + فعل: I need to leave early.", "tags": ["daily"], "ex": "I need a taxi to the station."},
    {"id": "en:chunk:can-i-have", "cefr": "A1", "title": "Can I have…?", "gloss": "میشه … داشته باشم؟ (درخواست مؤدبانه)", "expl": "در سفارش/درخواست روزمره: Can I have the menu, please?", "tags": ["food", "polite"], "ex": "Can I have the bill, please?"},
    {"id": "en:chunk:on-the-left", "cefr": "A1", "title": "on the left / on the right", "gloss": "سمت چپ / سمت راست", "expl": "برای جهت‌دهی: The bank is on the left.", "tags": ["travel", "directions"], "ex": "The pharmacy is on the right."},
    {"id": "en:chunk:have-to", "cefr": "A2", "title": "have to + verb", "gloss": "مجبور بودن", "expl": "الزامِ بیرونی: I have to leave now. گذشته: had to.", "tags": ["daily", "work"], "ex": "I have to catch the last bus."},
    {"id": "en:chunk:going-to", "cefr": "A2", "title": "be going to + verb", "gloss": "قرار است… (برنامه/نیت)", "expl": "برنامه‌ی قبلی: We're going to visit Shiraz in spring.", "tags": ["daily", "travel"], "ex": "I'm going to start a course."},
    {"id": "en:chunk:a-bit", "cefr": "A2", "title": "a bit + adjective", "gloss": "کمی، یک‌ذره", "expl": "تعدیل‌گر صفت: a bit expensive / a bit tired.", "tags": ["daily"], "ex": "The room was a bit small."},
    {"id": "en:chunk:on-time", "cefr": "A2", "title": "on time", "gloss": "به‌موقع", "expl": "on time = سرِ وقت مقرر؛ in time = قبل از اینکه دیر شود.", "tags": ["travel", "work"], "ex": "The train arrived on time."},
    {"id": "en:chunk:by-the-way", "cefr": "A2", "title": "by the way", "gloss": "راستی…", "expl": "برای تغییر موضوع حین گفتگو.", "tags": ["smalltalk"], "ex": "By the way, do you like coffee?"},
    {"id": "en:chunk:how-about", "cefr": "A2", "title": "How about…?", "gloss": "…چطور؟ (پیشنهاد)", "expl": "بعد از آن فعل با ing می‌آید: How about going on Friday?", "tags": ["smalltalk", "plans"], "ex": "How about meeting at six?"},
    {"id": "en:chunk:at-least", "cefr": "B1", "title": "at least", "gloss": "حداقل", "expl": "Stay at least two nights / at least ten minutes.", "tags": ["daily", "travel"], "ex": "I need at least two days."},
    {"id": "en:chunk:it-depends", "cefr": "B1", "title": "It depends (on…)", "gloss": "بستگی دارد", "expl": "It depends on the weather — روی on تأکید کنید؛ بدون مکمل هم درست است.", "tags": ["daily", "smalltalk"], "ex": "It depends on the price."},
    {"id": "en:chunk:i-was-wondering", "cefr": "B1", "title": "I was wondering if…", "gloss": "می‌خواستم بپرسم که… (خیلی مؤدبانه)", "expl": "گذشته استمراری برای درخواستِ خیلی مؤدبانه: I was wondering if you could help me.", "tags": ["polite", "work"], "ex": "I was wondering if I could leave early."},
    {"id": "en:chunk:the-thing-is", "cefr": "B1", "title": "The thing is…", "gloss": "مسئله این است که…", "expl": "برای توضیح دلیل یا مانع واقعی.", "tags": ["smalltalk"], "ex": "The thing is, I don't have the password."},
    {"id": "en:chunk:im-afraid", "cefr": "B1", "title": "I'm afraid…", "gloss": "متأسفانه… (رد/خبَرمؤدبانه)", "expl": "برای خبر بد یا رد کردنِ مؤدبانه: I'm afraid we're fully booked.", "tags": ["polite", "travel"], "ex": "I'm afraid the room is taken."},
    {"id": "en:chunk:look-forward-to", "cefr": "B1", "title": "look forward to + ing", "gloss": "بی‌صبرانه منتظر بودن", "expl": "بعد از to فعل با ing می‌آید: I look forward to hearing from you.", "tags": ["work", "email"], "ex": "I look forward to your reply."},
    {"id": "en:chunk:make-sure", "cefr": "B1", "title": "make sure (that)…", "gloss": "مطمئن شو که…", "expl": "Make sure you have your passport.", "tags": ["travel", "daily"], "ex": "Make sure the door is locked."},
    {"id": "en:chunk:keep-in-touch", "cefr": "B1", "title": "keep in touch", "gloss": "در تماس بودن", "expl": "Let's keep in touch = شماره‌مان نرود.", "tags": ["smalltalk", "family"], "ex": "Let's keep in touch by email."},
    {"id": "en:chunk:would-rather", "cefr": "B1", "title": "would rather + verb", "gloss": "ترجیح می‌دهم", "expl": "بعد از آن فعلِ ساده می‌آید: I'd rather stay home tonight.", "tags": ["daily"], "ex": "I'd rather walk than wait."},
]

CHUNK_EDGES = [
    ("en:chunk:how-many", "en:grammar:countable-uncountable", "prerequisite"),
    ("en:chunk:how-many", "en:chunk:how-much", "confusable"),      # sample
    ("en:chunk:there-is-there-are", "en:grammar:plural-count-nouns", "prerequisite"),  # sample
    ("en:chunk:i-need", "en:grammar:present-simple", "prerequisite"),  # sample
    ("en:chunk:can-i-have", "en:word:can", "prerequisite"),            # sample
    ("en:chunk:have-to", "en:grammar:modals-obligation", "prerequisite"),
    ("en:chunk:going-to", "en:grammar:future-going-to", "prerequisite"),
    ("en:chunk:on-time", "en:grammar:prepositions-time-place", "prerequisite"),
    ("en:chunk:it-depends", "en:word:depend", "prerequisite"),
    ("en:chunk:i-was-wondering", "en:grammar:past-continuous", "prerequisite"),
    ("en:chunk:look-forward-to", "en:grammar:prepositions-time-place", "prerequisite"),
    ("en:chunk:make-sure", "en:word:make", "prerequisite"),            # sample
    ("en:chunk:would-rather", "en:word:prefer", "related"),
    ("en:chunk:on-the-left", "en:pragmatic:asking-directions", "related"),  # sample
    ("en:chunk:how-about", "en:pragmatic:making-plans", "related"),
]

# ── grammar patterns ──
GRAMMAR = [
    {"id": "en:grammar:present-continuous", "cefr": "A1", "title": "Present Continuous", "gloss": "حال استمراری", "expl": "am/is/are + فعل+ing برای الان: I am studying now.", "tags": ["daily"], "ex": "Right now, I am writing an email."},
    {"id": "en:grammar:past-continuous", "cefr": "A2", "title": "Past Continuous", "gloss": "گذشته استمراری", "expl": "was/were + ing برای کاری در جریان: I was cooking when you called.", "tags": ["daily"], "ex": "We were eating when the phone rang."},
    {"id": "en:grammar:future-will", "cefr": "A1", "title": "Future with will", "gloss": "آینده با will", "expl": "تصمیم لحظه‌ای/پیش‌بینی: I'll call you later. It will rain.", "tags": ["daily"], "ex": "I'll help you with the bags."},
    {"id": "en:grammar:future-going-to", "cefr": "A1", "title": "Future with going to", "gloss": "آینده با going to", "expl": "برنامه/نیت قبلی یا نشانه‌ی روشن: We're going to travel in spring.", "tags": ["daily"], "ex": "Look at the clouds — it's going to rain."},
    {"id": "en:grammar:comparatives", "cefr": "A1", "title": "Comparatives", "gloss": "صفت تفضیلی", "expl": "-er / more + than: cheaper than, more expensive than.", "tags": ["daily", "shopping"], "ex": "This hotel is cheaper than that one."},
    {"id": "en:grammar:superlatives", "cefr": "A2", "title": "Superlatives", "gloss": "صفت عالی", "expl": "the + -est / the most: the cheapest, the most famous.", "tags": ["daily"], "ex": "It's the most beautiful city in Iran."},
    {"id": "en:grammar:countable-uncountable", "cefr": "A1", "title": "Countable vs uncountable nouns", "gloss": "اسم قابل‌شمارش و غیرقابل‌شمارش", "expl": "water/money/information غیرقابل‌شمارش‌اند: a water غلط است — a glass of water.", "tags": ["daily"], "ex": "I need some information about the tour."},
    {"id": "en:grammar:quantifiers", "cefr": "A2", "title": "Quantifiers: some/any/much/many", "gloss": "کمیت‌نماها", "expl": "some در مثبت، any در منفی/سؤال؛ much با غیرقابل‌شمارش، many با قابل‌شمارش.", "tags": ["daily", "shopping"], "ex": "Do we have any milk?"},
    {"id": "en:grammar:modals-advice-should", "cefr": "A2", "title": "Should (advice)", "gloss": "should برای نصیحت", "expl": "should/shouldn't: You should book early. You shouldn't worry.", "tags": ["daily"], "ex": "You should visit Shiraz in spring."},
    {"id": "en:grammar:modals-obligation", "cefr": "A2", "title": "Must / have to (obligation)", "gloss": "الزام: must و have to", "expl": "must الزامِ قوی از خود گوینده؛ have to از قواعد بیرونی: I have to wear a uniform.", "tags": ["daily", "work"], "ex": "You must have a visa."},
    {"id": "en:grammar:frequency-adverbs", "cefr": "A1", "title": "Adverbs of frequency", "gloss": "قیدهای تکرار", "expl": "always/usually/often/sometimes/never — قبل از فعل اصلی، بعد از be.", "tags": ["daily"], "ex": "She is always on time."},
    {"id": "en:grammar:prepositions-time-place", "cefr": "A1", "title": "Prepositions of time & place", "gloss": "in / on / at برای زمان و مکان", "expl": "in شهر/ماه/سال، on روز/تاریخ، at ساعت/مکان مشخص: in Shiraz, on Monday, at 5.", "tags": ["daily", "travel"], "ex": "I was born in Shiraz in March."},
    {"id": "en:grammar:possessives", "cefr": "A1", "title": "Possessives (my / 's)", "gloss": "ملکیت: my و ’s", "expl": "my/your/his… + اسم‌ها با ’s: my sister’s car.", "tags": ["daily", "family"], "ex": "This is my sister’s car."},
    {"id": "en:grammar:questions-do-support", "cefr": "A1", "title": "Questions with do/does", "gloss": "سؤال ساختن با do/does", "expl": "در سؤال و منفیِ حال ساده do/does می‌آید: Do you like tea? — She doesn't work here.", "tags": ["daily"], "ex": "Do you live near here?"},
]

GRAMMAR_EDGES = [
    ("en:grammar:present-simple", "en:grammar:present-continuous", "prerequisite"),   # sample
    ("en:grammar:present-continuous", "en:grammar:future-going-to", "prerequisite"),
    ("en:grammar:past-simple", "en:grammar:past-continuous", "prerequisite"),         # sample
    ("en:grammar:comparatives", "en:grammar:superlatives", "prerequisite"),
    ("en:grammar:countable-uncountable", "en:grammar:quantifiers", "prerequisite"),
    ("en:grammar:countable-uncountable", "en:grammar:plural-count-nouns", "related"), # sample
    ("en:grammar:present-simple", "en:grammar:future-will", "prerequisite"),
    ("en:grammar:present-simple", "en:grammar:modals-advice-should", "prerequisite"),
    ("en:grammar:present-simple", "en:grammar:modals-obligation", "prerequisite"),
    ("en:grammar:present-simple", "en:grammar:frequency-adverbs", "prerequisite"),
    ("en:grammar:present-simple", "en:grammar:questions-do-support", "prerequisite"),
    ("en:grammar:future-will", "en:grammar:future-going-to", "confusable"),
]

# ── pragmatic skills ──
PRAGMATIC = [
    {"id": "en:pragmatic:shopping-paying", "cefr": "A1", "title": "Shopping & paying", "gloss": "خرید و پرداخت", "expl": "الگوها: How much is this? / Can I pay by card? / I'll take it.", "tags": ["shopping"], "ex": "I'll take this one — card, please."},
    {"id": "en:pragmatic:small-talk-weather", "cefr": "A1", "title": "Small talk: weather", "gloss": "گپ کوچک درباره‌ی هوا", "expl": "شروع‌کننده‌ی گفتگو: Nice day, isn't it? / It's raining again!", "tags": ["smalltalk"], "ex": "Nice weather today, isn't it?"},
    {"id": "en:pragmatic:asking-for-help", "cefr": "A1", "title": "Asking for help", "gloss": "کمک خواستن", "expl": "Could you help me, please? / Sorry, I don't understand.", "tags": ["polite", "daily"], "ex": "Could you help me with this form?"},
    {"id": "en:pragmatic:making-plans", "cefr": "A2", "title": "Making plans with others", "gloss": "برنامه‌ریزی با دیگران", "expl": "How about…? / Are you free on Friday? / Let's meet at six.", "tags": ["smalltalk", "plans"], "ex": "Are you free on Thursday evening?"},
    {"id": "en:pragmatic:restaurant-reservation", "cefr": "A2", "title": "Restaurant reservation", "gloss": "رزرو رستوران", "expl": "I'd like to book a table for two at eight, under Ahmadi.", "tags": ["food", "polite"], "ex": "I'd like to book a table for two."},
    {"id": "en:pragmatic:giving-directions", "cefr": "A2", "title": "Giving directions", "gloss": "مسیر دادن", "expl": "Go straight / turn left at the corner / it's next to the bank.", "tags": ["travel", "directions"], "ex": "Go straight and turn left at the bank."},
    {"id": "en:pragmatic:at-the-pharmacy", "cefr": "A2", "title": "At the pharmacy", "gloss": "داروخانه", "expl": "I need something for a headache. / How often should I take it?", "tags": ["health"], "ex": "I need something for a sore throat."},
    {"id": "en:pragmatic:doctor-appointment", "cefr": "B1", "title": "Doctor appointment", "gloss": "وقت دکتر", "expl": "I'd like to make an appointment. / I've had a fever since Monday.", "tags": ["health"], "ex": "I've had this cough for a week."},
    {"id": "en:pragmatic:job-interview-basics", "cefr": "B1", "title": "Job interview basics", "gloss": "مصاحبه‌ی کاری (مقدماتی)", "expl": "I work well in a team. / My strength is solving problems.", "tags": ["work"], "ex": "I work well under pressure."},
    {"id": "en:pragmatic:email-writing-basics", "cefr": "B1", "title": "Email writing basics", "gloss": "نگارش ایمیل", "expl": "Dear Mr Ahmadi, / I'm writing to ask about… / Best regards.", "tags": ["work", "email"], "ex": "I'm writing to ask about the position."},
    {"id": "en:pragmatic:complaining-politely", "cefr": "B1", "title": "Complaining politely", "gloss": "شکایت مؤدبانه", "expl": "Excuse me, there's a problem with my order. / Would you mind…?", "tags": ["polite", "travel"], "ex": "Excuse me, the heater isn't working."},
]

PRAGMATIC_EDGES = [
    ("en:chunk:how-much", "en:pragmatic:shopping-paying", "prerequisite"),   # sample
    ("en:word:pay", "en:pragmatic:shopping-paying", "prerequisite"),
    ("en:chunk:can-i-have", "en:pragmatic:shopping-paying", "prerequisite"),
    ("en:word:weather", "en:pragmatic:small-talk-weather", "prerequisite"),
    ("en:word:rain", "en:pragmatic:small-talk-weather", "prerequisite"),
    ("en:chunk:could-you", "en:pragmatic:asking-for-help", "prerequisite"),  # sample
    ("en:word:help", "en:pragmatic:asking-for-help", "prerequisite"),        # sample
    ("en:chunk:how-about", "en:pragmatic:making-plans", "prerequisite"),
    ("en:chunk:going-to", "en:pragmatic:making-plans", "prerequisite"),
    ("en:chunk:i-would-like", "en:pragmatic:restaurant-reservation", "prerequisite"),  # sample
    ("en:word:reserve", "en:pragmatic:restaurant-reservation", "prerequisite"),
    ("en:chunk:on-the-left", "en:pragmatic:giving-directions", "prerequisite"),
    ("en:grammar:prepositions-time-place", "en:pragmatic:giving-directions", "prerequisite"),
    ("en:word:medicine", "en:pragmatic:at-the-pharmacy", "prerequisite"),
    ("en:word:sick", "en:pragmatic:at-the-pharmacy", "prerequisite"),
    ("en:grammar:present-perfect", "en:pragmatic:doctor-appointment", "prerequisite"),  # sample
    ("en:word:medicine", "en:pragmatic:doctor-appointment", "prerequisite"),
    ("en:word:experience", "en:pragmatic:job-interview-basics", "prerequisite"),
    ("en:word:confident", "en:pragmatic:job-interview-basics", "prerequisite"),
    ("en:chunk:look-forward-to", "en:pragmatic:email-writing-basics", "prerequisite"),
    ("en:word:arrange", "en:pragmatic:email-writing-basics", "prerequisite"),
    ("en:chunk:would-you-mind", "en:pragmatic:complaining-politely", "prerequisite"),    # sample
    ("en:chunk:im-afraid", "en:pragmatic:complaining-politely", "prerequisite"),
    # cluster membership
    ("en:pragmatic:shopping-paying", "en:cluster:shopping-money", "part_of"),
    ("en:pragmatic:small-talk-weather", "en:cluster:social-smalltalk", "part_of"),
    ("en:pragmatic:making-plans", "en:cluster:social-smalltalk", "part_of"),
    ("en:pragmatic:restaurant-reservation", "en:cluster:food-dining", "part_of"),
    ("en:pragmatic:job-interview-basics", "en:cluster:work-study", "part_of"),
    ("en:pragmatic:email-writing-basics", "en:cluster:work-study", "part_of"),
    ("en:pragmatic:complaining-politely", "en:cluster:social-smalltalk", "part_of"),
    ("en:pragmatic:giving-directions", "en:cluster:travel-core", "part_of"),
    ("en:pragmatic:asking-for-help", "en:cluster:daily-life", "part_of"),
]

# ── fa→en error patterns ──
ERRORS = [
    {"id": "en:err:l1-prodrop", "cefr": "A1", "title": "Dropping the subject (L1)", "gloss": "حذف فاعل", "expl": "فارسی فاعل را می‌اندازد («باران می‌بارد»)؛ انگلیسی فاعل قائم‌الجاه می‌خواهد: It is raining.", "tags": ["fa-l1"], "ex": "✗ Is raining. ✓ It's raining."},
    {"id": "en:err:l1-make-do", "cefr": "A1", "title": "make/do swap (L1)", "gloss": "جابجایی make و do", "expl": "فارسی «کردن» برای هر دو: ✗ do a mistake ✓ make a mistake؛ ✗ make homework ✓ do homework.", "tags": ["fa-l1"], "ex": "✗ I did a mistake. ✓ I made a mistake."},
    {"id": "en:err:l1-much-many", "cefr": "A1", "title": "much/many confusion (L1)", "gloss": "اشتباه much و many", "expl": "فارسی تفکیک نمی‌کند: much با غیرقابل‌شمارش، many با قابل‌شمارش.", "tags": ["fa-l1"], "ex": "✗ How much books? ✓ How many books?"},
    {"id": "en:err:l1-countable-misuse", "cefr": "A1", "title": "Pluralizing uncountables (L1)", "gloss": "جمع‌بستن اسم غیرقابل‌شمارش", "expl": "✗ informations / advices / furnitures ✓ information / advice / furniture.", "tags": ["fa-l1"], "ex": "✗ I have many informations. ✓ I have a lot of information."},
    {"id": "en:err:l1-since-for", "cefr": "A2", "title": "since/for confusion (L1)", "gloss": "اشتباه since و for", "expl": "فارسی «از» برای هر دو: since + نقطه‌ی شروع (since 2020)، for + مدت (for two years).", "tags": ["fa-l1"], "ex": "✗ I live here since two years. ✓ I've lived here for two years."},
    {"id": "en:err:l1-prepositions-time", "cefr": "A2", "title": "in/on/at for time (L1)", "gloss": "حرف اضافه‌ی زمان", "expl": "فارسی یک «در» دارد: on روز، in ماه/سال، at ساعت: on Monday, in July, at 5 o'clock.", "tags": ["fa-l1"], "ex": "✗ I will come in Monday. ✓ I will come on Monday."},
    {"id": "en:err:l1-infinitive-gerund", "cefr": "A2", "title": "to+verb after ing-verbs (L1)", "gloss": "مصدر به‌جای ing", "expl": "بعد از enjoy/suggest/avoid/finish فعل با ing می‌آید: ✗ I enjoy to watch ✓ I enjoy watching.", "tags": ["fa-l1"], "ex": "✗ She suggested to go. ✓ She suggested going."},
    {"id": "en:err:l1-past-vs-present-perfect", "cefr": "B1", "title": "Past simple for experiences (L1)", "gloss": "گذشته‌ی ساده به‌جای حال کامل", "expl": "برای تجربه بدون زمانِ مشخص، حال کامل: ✗ Did you ever see snow? ✓ Have you ever seen snow?", "tags": ["fa-l1"], "ex": "✗ I never was in London. ✓ I've never been to London."},
]

ERROR_EDGES = [
    ("en:err:l1-prodrop", "en:grammar:present-simple", "related"),                     # sample
    ("en:err:l1-prodrop", "en:grammar:present-continuous", "related"),
    ("en:err:l1-make-do", "en:word:make", "related"),                                  # sample
    ("en:err:l1-make-do", "en:word:do", "related"),                                    # sample
    ("en:err:l1-much-many", "en:grammar:quantifiers", "related"),
    ("en:err:l1-much-many", "en:chunk:how-much", "related"),                           # sample
    ("en:err:l1-countable-misuse", "en:grammar:countable-uncountable", "related"),
    ("en:err:l1-countable-misuse", "en:word:luggage", "related"),                      # sample
    ("en:err:l1-since-for", "en:grammar:present-perfect", "related"),                  # sample
    ("en:err:l1-prepositions-time", "en:grammar:prepositions-time-place", "related"),
    ("en:err:l1-infinitive-gerund", "en:grammar:questions-do-support", "related"),
    ("en:err:l1-past-vs-present-perfect", "en:grammar:present-perfect", "related"),    # sample
    ("en:err:l1-past-vs-present-perfect", "en:grammar:past-simple", "confusable"),     # sample
]

# ── topic clusters (new) ──
CLUSTERS = [
    {"id": "en:cluster:food-dining", "cefr": None, "title": "Food & dining", "gloss": "خوشه‌ی غذا و رستوران", "expl": "واژه‌ها، قالب‌ها و مهارت‌های غذا خوردن و سفارش دادن.", "tags": ["food", "restaurant"], "ex": ""},
    {"id": "en:cluster:work-study", "cefr": None, "title": "Work & study", "gloss": "خوشه‌ی کار و درس", "expl": "واژه‌ها و مهارت‌های محیط کار و تحصیل.", "tags": ["work", "exam"], "ex": ""},
    {"id": "en:cluster:shopping-money", "cefr": None, "title": "Shopping & money", "gloss": "خوشه‌ی خرید و پول", "expl": "خرید، قیمت، پرداخت.", "tags": ["shopping"], "ex": ""},
    {"id": "en:cluster:social-smalltalk", "cefr": None, "title": "Social & small talk", "gloss": "خوشه‌ی گفتگوی اجتماعی", "expl": "گپ کوچک، احوال‌پرسی، برنامه‌ریزی دوستانه.", "tags": ["smalltalk"], "ex": ""},
]

CLUSTER_EDGES = [
    # extend the two SAMPLE clusters too (hotel-checkin & co. already part_of there in the sample)
    ("en:word:journey", "en:cluster:travel-core", "part_of"),   # sample word
    ("en:word:recommend", "en:cluster:food-dining", "part_of"), # sample word
    ("en:word:water", "en:cluster:food-dining", "part_of"),     # sample word
    ("en:pragmatic:ordering-food", "en:cluster:food-dining", "part_of"),  # sample pragmatic
]
