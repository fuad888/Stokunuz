# Stock USA — Claude-dan kənar, pulsuz platforma

Bu qovluqda **tam işlək** bir sistem var:

- `index.html` — ictimai vitrin (müştərilər görür, canlı məlumat)
- `admin.html` — sizin idarəetmə paneliniz (giriş tələb edir)
- `scripts/check-stock.js` — avtomatik stok/qiymət yoxlama botu (GitHub Actions-da işləyir, **heç bir təsdiq/icazə istəmir**)
- `firestore.rules` — təhlükəsizlik qaydaları

Hamısı **tam pulsuz**: Firebase (Google) + GitHub Pages + GitHub Actions.

---

## 1. Firebase layihəsi yaradın

1. https://console.firebase.google.com → **"Add project"** → ad verin (məs. `stock-usa`) → davam edin (Google Analytics-i istəyirsinizsə saxlaya, istəməsəniz söndürə bilərsiniz) → **Create project**.

## 2. Firestore Database yaradın

1. Sol menyudan **Build → Firestore Database** → **Create database**.
2. Rejim: **Production mode** seçin (qaydaları özümüz aşağıda yazacağıq) → sizə yaxın region seçin → **Enable**.

## 3. Authentication aktivləşdirin (admin girişi üçün)

1. Sol menyudan **Build → Authentication** → **Get started**.
2. **Sign-in method** tabında **Email/Password**-u aktivləşdirin.
3. **Users** tabına keçin → **Add user** → öz emailinizi və bir parol yazın. Bu, `admin.html`-ə giriş üçün istifadə edəcəyiniz hesabdır — başqa heç kim bu paneli görə bilməyəcək.

## 4. Web tətbiq konfiqurasiyasını götürün

1. Sol yuxarıda dişli işarəsi → **Project settings**.
2. **"Your apps"** bölməsində **`</>`** (Web) ikonuna basın → ad verin (məs. `stock-usa-web`) → **Register app**.
3. Görünən `firebaseConfig` obyektini kopyalayın.
4. Bu qovluqdakı **`firebase-config.js`** faylını açın, `PASTE_YOUR_...` yerlərini öz dəyərlərinizlə əvəz edin, saxlayın.

## 5. Təhlükəsizlik qaydalarını yükləyin

1. Firestore Database → **Rules** tabı.
2. Bu qovluqdakı **`firestore.rules`** faylının içindəkini tam kopyalayıb, Firebase Console-dakı redaktora yapışdırın → **Publish**.

*(Bu qayda: hər kəs vitrini oxuya bilər, amma yalnız giriş etmiş — yəni sizin — hesab məhsul əlavə/redaktə/silə bilər.)*

## 6. Bot üçün Service Account açarı alın

1. Project settings → **Service accounts** tabı.
2. **"Generate new private key"** → JSON fayl kompüterinizə enəcək.
3. Bu faylı **açmayın/paylaşmayın** — bu, botun bazaya yazması üçün "master açar"dır. Aşağıda GitHub-a **secret** kimi əlavə edəcəyik (heç kim görməyəcək, hətta siz özünüz də təkrar baxa bilməyəcəksiniz).

## 7. GitHub-da repo yaradın

1. github.com-da **"New repository"** → ad verin (məs. `stock-usa`) → **Public** seçin (pulsuz GitHub Pages üçün lazımdır) → **Create repository**.
2. Repo səhifəsində **"Add file" → "Upload files"** düyməsi ilə bu qovluqdakı **bütün fayl və qovluqları** (o cümlədən `.github` gizli qovluğunu) sürüşdürüb buraxın → **Commit changes**.
   - `.github/workflows/check-stock.yml` faylının düzgün yerə düşdüyünə diqqət edin (GitHub-un veb yükləməsi bəzən gizli qovluqları düzgün tanımaya bilir — əgər tanımasa, mənə deyin, alternativ üsul göstərərəm).

## 8. Service Account açarını GitHub-a "secret" kimi əlavə edin

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. Ad: `FIREBASE_SERVICE_ACCOUNT`
3. Dəyər: 6-cı addımda endirdiyiniz JSON faylın **bütün məzmununu** açıb yapışdırın.
4. **Add secret**.

## 9. GitHub Pages-i aktivləşdirin (vitrin + admin panel üçün)

1. Repo → **Settings → Pages**.
2. **Source**: "Deploy from a branch" → **Branch**: `main`, qovluq: `/ (root)` → **Save**.
3. Bir-iki dəqiqədən sonra saytınız bu ünvanda olacaq: `https://İSTİFADƏÇİ_ADINIZ.github.io/REPO_ADI/`
   - Vitrin: `.../index.html` (və ya sadəcə əsas link)
   - İdarəetmə paneli: `.../admin.html`

## 10. Botu işə salın

1. Repo → **Actions** tabı → soldan **"Stock check"** workflow-u seçin → **"Run workflow"** düyməsi ilə əl ilə bir dəfə işə sala bilərsiniz (test üçün).
2. Bundan sonra **hər 30 dəqiqədə bir avtomatik**, heç bir təsdiq istəmədən işləyəcək.

---

## İndi necə işləyəcək

- `admin.html`-ə öz email/parolunuzla daxil olub məhsul əlavə edirsiniz.
- Bot hər 30 dəqiqədə bir bütün "avtomatik" məhsulları yoxlayıb Firestore-u yeniləyir.
- `index.html` (vitrin) Firestore-u **canlı** oxuyur — köhnə sistemdə olan "vitrin köhnəlib qalır" problemi artıq yoxdur, çünki ayrıca "regenerate + republish" addımı ləğv olundu.
- Heç bir addımda sizdən "icazə ver" soruşulmur — GitHub Actions tam sərbəst işləyir.

## Bilməli olduğunuz məhdudiyyətlər

- **Bəzi saytlar avtomatik yoxlanıla bilməyəcək** (Cloudflare/CAPTCHA qorumalı, giriş tələb edən saytlar) — bunlar `needs_manual_check` statusunda qalacaq, admin paneldə "Stok/ölçünü özüm daxil edim" ilə əl ilə idarə edə bilərsiniz. Bu, istənilən pulsuz (və çox vaxt ödənişli) sistemin ortaq məhdudiyyətidir.
- **Ölçü-səviyyəli stok** (hansı ölçü bitib) avtomatik aşkarlanmır — bot yalnız ümumi stok statusu və qiyməti tapır. Konkret ölçüləri əl ilə yeniləməlisiniz (əvvəlki Claude-based sistemdə bunu bir LLM edirdi, sadə skript bunu etibarlı şəkildə edə bilmir).
- **Firestore pulsuz tarifi**: gündə 50,000 oxuma / 20,000 yazma — kiçik mağaza üçün kifayətdən artıqdır.
- **Domen**: `github.io` subdomeni tam pulsuzdur. Əsl domen (məs. `stockusa.az`) almaq istəsəniz, bu ayrıca alınmalıdır (pulsuz deyil) və sonra GitHub Pages-ə bağlana bilər — istəsəniz bu addımı da izah edərəm.
- `firebase-config.js`-dəki dəyərlər (apiKey və s.) **məxfi deyil** — bunlar hər Firebase veb tətbiqində açıq olur, təhlükəsizlik `firestore.rules` və Authentication ilə təmin olunur, konfiqurasiyanın gizlədilməsi ilə deyil. Amma `FIREBASE_SERVICE_ACCOUNT` açarını **heç vaxt** repoya commit etməyin — yalnız GitHub secret kimi saxlayın.
