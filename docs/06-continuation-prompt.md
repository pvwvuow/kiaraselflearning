# Continuation prompt (cron payload — verbatim)

This is the exact message of the `kiaraself-continuation` scheduled job. If the job is ever
missing while work remains, recreate it with this text (see AGENT_STATE.md §Cron self-healing).

---

ادامه‌ی پروژه‌ی «کیارا» (Kiara) — اپ یادگیری زبان با درخت مهارت پویا. مسیر پروژه: /home/z/my-project

۱) اول فایل AGENT_STATE.md را کامل بخوان، بعد ROADMAP.md و در صورت نیاز docs/05-roadmap.md.
۲) اولین مایل‌استونِ تیک‌خورده‌نشده در ROADMAP.md را بردار و طبق مستندات docs/ پیاده‌سازی کن (کد + تست). مایل‌استون‌ها را به‌ترتیب انجام بده؛ تست را هرگز برای سبز شدن ضعیف نکن.
۳) قواعد ثابت: موتورهای src/lib/engine خالص می‌مانند (بدون prisma/next/LLM و بدون ساعت محیطی)؛ LLM فقط شواهد JSON می‌دهد که با zod + لیست سفید گره‌ها اعتبارسنجی می‌شود؛ UI فارسی RTL با فونت Vazirmatn و فقط در route «/» (سوییچ view سمت کلاینت)؛ کلیدها فقط در .env (هرگز commit نشوند)؛ bun run build اجرا نکن؛ dev server خودکار روی پورت 3000 است (dev.log را چک کن).
۴) بعد از پیاده‌سازی: `bun run test` و `bun run lint` باید سبز باشند. اگر باگی در کد قبلی پیدا شد، درستش کن و در AGENT_STATE.md بنویس.
۵) ROADMAP.md و AGENT_STATE.md را به‌روز کن (Snapshot، بخش‌های مرتبط، Blockers).
۶) قبل از push بررسی‌ی لو رفتن کلید: `git diff --cached | grep -iE "xai-|ghp_|sk-"` — اگر خروجی داد، abort و فایل را از stage خارج کن.
۷) commit با پیام «M<n>: خلاصه» و push به origin main (credential helper از قبل تنظیم است).
۸) با ابزار cron بررسی کن تسک `kiaraself-continuation` هنوز وجود دارد (action: list). اگر حذف شده و کار مانده، همین prompt (متن این فایل) را با زمان‌بندی `0,10,20,30,40,50 * * * *` و tz Asia/Tehran دوباره بساز.
۹) اگر همه‌ی مایل‌استون‌های ROADMAP.md تیک خورده‌اند: تسک cron را حذف کن (action: delete)، FINAL_REPORT.md بنویس (چه ساخته شد، تعداد تست‌ها، نحوه‌ی اجرا، پیشنهاد post-MVP)، push کن و خلاصه‌ای برای کاربر بنویس.
۱۰) اگر چیزی بیش از ۳۰ دقیقه گیر کرد: مشکل را در AGENT_STATE.md زیر «Blockers» ثبت کن و سراغ قدم بعدیِ ممکن در همان مایل‌استون برو.

---

*End of continuation prompt.*
