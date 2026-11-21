# Testing the shopper app through the stores

How the owner gets the Yuntera shopper app onto testers' phones through
Google Play's internal testing track and Apple's TestFlight. Written for
someone who is not a developer: every step says where to click.

**What testers get.** These test builds talk to the hosted _preview_ backend,
which holds demo data only: no real products, orders or payments. Only the
shopper app is complete; the seller, driver and warehouse apps are not ready
for store testing.

**Which Expo account.** The app's Expo project is `yuntera` in the owner's
Expo **team** account (the team account that already holds the company's
Apple credentials), not in the personal account. The project in the personal
account is an earlier one and is no longer used for store builds.

**Where things stand (21 November 2026).** The team-account project exists
and the first Android store build was started from it. That build created
the Android upload key for `com.yuntera.shop` on Expo's servers, so the
Expo upload slot in Part 1, step 5 now exists. Nothing has been uploaded to
Google Play yet: that waits for the owner's service account key.

## Part 1: Android (Google Play internal testing)

Internal testing reaches up to 100 testers chosen by their Google account,
with no review by Google before they can install.

### 1. Create the app in Play Console (done)

In [Google Play Console](https://play.google.com/console), **Create app**,
with the package name **`com.yuntera.shop`**. This is already done. The
package name can never be changed afterwards, and every build must carry
exactly this one.

### 2. Create a Google Cloud service account and its key

Expo uploads builds to Google Play with a "service account", a robot user
that belongs to the owner's Google Cloud project.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and pick
   (or create) the project that will hold the service account.
2. Go to **IAM & Admin** > **Service accounts** > **Create service account**.
   Name it, for example, `expo-submit`. Click **Create and continue**, skip
   the optional roles, then **Done**.
3. Click the new service account > **Keys** > **Add key** > **Create new
   key** > **JSON** > **Create**. A `.json` file downloads.
4. Keep that file private: it lets whoever holds it upload builds. Do not
   e-mail it or put it in a chat; it is uploaded once, to Expo, in step 5.
5. Copy the service account's e-mail address (it ends in
   `iam.gserviceaccount.com`); step 4 needs it.

Expo's own walkthrough with screenshots:
[Creating a Google Service Account key](https://expo.fyi/creating-google-service-account).

### 3. Enable the Google Play Android Developer API

In the same Google Cloud project, open **APIs & Services** > **Library**,
search for **Google Play Android Developer API**, open it and click
**Enable**.

### 4. Invite the service account in Play Console

In Play Console, **Users and permissions** > **Invite new users**:

1. **Email address**: the service account's address from step 2.
2. Under **App permissions**, add the Yuntera app and tick exactly these:
   - View app information (read-only)
   - Edit and delete draft apps
   - Release to production, exclude devices, and use Play App Signing
   - Release apps to testing tracks
   - Manage testing tracks and edit tester lists
   - Manage store presence
3. Click **Invite user**, then **Send invite**. A service account does not
   need to accept the invitation.

### 5. Upload the key on Expo's website

The slot belongs to the Android credentials the first store build created in
the team account's project. Make sure the page shows the team account and
the project **yuntera**, not the personal account and not any other project.

1. Sign in at [expo.dev](https://expo.dev).
2. In the account menu at the top left, switch to the **team** account.
3. Open **Projects** > **yuntera**.
4. In the project's menu, click **Credentials**.
5. Under **Android**, click the application identifier **`com.yuntera.shop`**.
6. Under **Service credentials**, in **Google service account key for Expo
   Submit**, click **Add a Google service account key**.
7. Keep **Upload new key** selected, choose the `.json` file from step 2 and
   click **Save**.
8. Tell the developer side that the key is uploaded. After that the
   developer side sends builds to Google Play without the owner.

### 6. Add testers

In Play Console, open the app > **Test and release** > **Testing** >
**Internal testing** > **Testers**. Click **Create email list**, name it (for
example "Equipo Yuntera"), add each tester's **Google account address** (the
one they use for the Play Store on their phone), **Save**, make sure the list
is ticked, and **Save** again.

### 7. Start the rollout of the draft release

The developer side uploads each build as a **draft** release, because a
Google Play app that has never been published accepts only draft releases.
For each new upload:

1. Play Console > the app > **Test and release** > **Testing** > **Internal
   testing** > **Releases**.
2. On the draft release, click **Edit** (or **Edit release**), then **Next**
   (or **Review release**).
3. Read any warnings (warnings do not block; errors do), then click **Save**
   and **Start rollout to Internal testing**, and confirm.

The first time, Play Console may also ask the owner to accept Play App
Signing (Google keeps the key that signs the app for phones; Expo keeps only
the "upload key"). Accept it.

### 8. Send testers the opt-in link

On the **Internal testing** page, under **Testers**, **How testers join your
test** shows a link. Copy it and send it to the testers. Each tester opens it
on their phone, signed in with the Google address added in step 6, taps
**Accept invitation**, then installs Yuntera from the Play Store. A new test
version can take a few minutes to appear for testers.

## Part 2: iPhone (TestFlight)

> **Do not run this part yet.** Wait until the developer side confirms that
> the iOS configuration is ready: the app's encryption declaration is still
> being settled. Running it earlier would make a build Apple may ask
> questions about.

This part is done once by the owner, on a computer, because Apple asks the
account holder to sign in. Every later iPhone version is built and sent by
the developer side.

**The company's Apple credentials are already in Expo.** The team account
already holds the company's Apple distribution certificate and an App Store
Connect API key. The command below offers to reuse both: answer **yes**. It
only needs to register the new app identifier `com.yuntera.shop` with Apple
and create that app's provisioning profile.

### Before starting

- **Node.js 22** and **git** installed on the computer
  ([nodejs.org](https://nodejs.org/), [git-scm.com](https://git-scm.com/)).
- The owner's Apple account has the **Account Holder** or **Admin** role in
  the company's Apple Developer team.
- No pending agreements: in [App Store Connect](https://appstoreconnect.apple.com/)
  > **Business** (and on [developer.apple.com](https://developer.apple.com/account/)),
  > accept any agreement Apple shows as waiting. Uploads fail while one is
  > pending.
- Testers have the **TestFlight** app installed on their iPhones.
- Testers are **App Store Connect users** of the company's team: App Store
  Connect > **Users and Access** > **+**, with their Apple ID e-mail. They
  must accept Apple's invitation e-mail.

### Build and send to TestFlight

In a terminal, from a copy (clone) of the Yuntera repository:

```bash
corepack enable
pnpm install
cd apps/shop-native
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile production --auto-submit
```

`login` asks for the Expo account's e-mail and password. The build command
then asks questions; answer:

| Question (wording may differ slightly)         | Answer                                                   |
| ---------------------------------------------- | -------------------------------------------------------- |
| Do you want to log in to your Apple account?   | **Yes**, then sign in with the Apple ID and the 2FA code |
| Choose the Apple team                          | the company's team                                       |
| Reuse the existing distribution certificate?   | **Yes**                                                  |
| Generate a new Apple Distribution Certificate? | **Yes** only if it does not offer to reuse one           |
| Generate a new Apple Provisioning Profile?     | **Yes**                                                  |
| Use the existing App Store Connect API key?    | **Yes**                                                  |
| Generate a new App Store Connect API key?      | **Yes** only if it does not offer to reuse one           |
| Set up push notifications?                     | **No** (the app does not send notifications yet)         |

The build runs on Expo's servers (about 15 to 30 minutes), then is sent to
App Store Connect. Apple processes it for another 10 to 15 minutes. The
first upload also creates the app's record in App Store Connect.

### Create an internal testing group

In App Store Connect > **Apps** > **Yuntera** > **TestFlight** > the **+**
next to **Internal Testing**, enter a group name, **Create**. Then the **+**
next to **Testers**, tick the testers, **Add**. They receive an e-mail and
install the app from TestFlight.

### Send the developer side the app's Apple ID number

App Store Connect > **Apps** > **Yuntera** > **App Information** > under
**General Information**, **Apple ID** (a number such as `6740000000`). Send
it to the developer side; it lets later builds be sent without asking the
owner anything.

## Afterwards

- **Owner:** for Android, start the rollout of each new draft release (Part
  1, step 7) and add or remove testers. For iPhone, add or remove testers in
  the TestFlight group.
- **Developer side:** builds new versions and sends them to both stores
  without the owner. Version numbers go up on their own.

## Limits

- **TestFlight outside the company team** (external testers, up to 10,000 by
  a public link) needs Apple's Beta App Review on the first build of each
  version, with a beta app description, a feedback e-mail, a **privacy
  policy address** and a **test account** for Apple's reviewers to sign in
  with. Internal testing needs none of these.
- **Google Play beyond internal testing** (closed, open or production) needs
  the store listing and the **Set up your app** tasks in Play Console: privacy
  policy, data safety, content rating, target audience.
- **Demo data only.** The builds talk to the hosted preview backend.
- **Only the shopper app** is ready for store testing.
