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

**Where things stand (24 November 2026).**

- **Android: released to the internal testers.** The build
  `a20ef1d8-a926-40d4-947d-823cd87be32a` (version 0.1.0, version code 4,
  made from commit `3f251c3`) was sent to Google Play's internal testing
  track on 22 November 2026 (Expo submission
  `8d09854a-da67-4919-afe6-114fc50f633f`) as a draft release. The owner
  started its rollout: Play Console shows release 0.1.0 as "Available to
  internal testers", released on 23 November 2026, "Not reviewed" (seen in
  the owner's screenshot of 24 November; the developer side cannot open Play
  Console). Until Google reviews the app, testers see it in Google Play
  under the temporary name "com.yuntera.shop (unreviewed)". Not yet
  confirmed: the app installed on a tester's phone.
- **iPhone: in App Store Connect.** The owner ran the one interactive build
  (Part 2) on 24 November 2026 from commit `3f251c3`: build
  `68a59cea-0f69-4745-9bd1-72eb6e90b399` (version 0.1.0, build number 4)
  finished on Expo and its submission
  `487ff981-58b0-4621-a39d-48603f91c9b9` to App Store Connect finished the
  same day (read on Expo). The app record **Yuntera** exists with Apple ID
  number `6838560774`. Expo holds, for `com.yuntera.shop`, the company's one
  distribution certificate (serial ends `91BA`, reused, not duplicated), a
  provisioning profile valid until 31 October 2027 and the App Store Connect
  key `8A673478NB` for submissions. Not yet confirmed: Apple finished
  processing the build, and the app installed from TestFlight.
- **Builds used** in the team account's cycle from 1 November to
  1 December 2026: Android 4 of 15, iOS 3 of 15 (2 before this build plus
  this one; counted, not read again from Expo's billing page). Nothing was
  billed.
- **Newer code is not in the stores.** Both store builds are made from
  `3f251c3`. The hosted preview has since received every migration up to
  `084300`, so a build of the newer screens (the account screens inside the
  app, the order follow-ups and the rest) is possible; the next builds for
  both stores are made once the work in progress is merged and on the
  preview. Apple's review asks for account deletion inside the app before
  the App Store; internal TestFlight testing has no review.

## Part 1: Android (Google Play internal testing)

Internal testing reaches up to 100 testers chosen by their Google account,
with no review by Google before they can install.

### 1. Create the app in Play Console (done)

In [Google Play Console](https://play.google.com/console), **Create app**,
with the package name **`com.yuntera.shop`**. This is already done. The
package name can never be changed afterwards, and every build must carry
exactly this one.

### 2. Create a Google Cloud service account and its key (done)

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

### 3. Enable the Google Play Android Developer API (done)

In the same Google Cloud project, open **APIs & Services** > **Library**,
search for **Google Play Android Developer API**, open it and click
**Enable**.

### 4. Invite the service account in Play Console (done)

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

### 5. Upload the key on Expo's website (done)

Done on 22 November 2026. Kept here for a new key or another app.

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

The first build was uploaded as a **draft** release, because a Google Play
app that has never been published accepts only draft releases, and the owner
started its rollout on 23 November 2026.

By the owner's decision of 23 November 2026 (decision 45), every later build
is sent with the release status "completed" (`apps/shop-native/eas.json`,
since 24 November 2026): it reaches the internal testers without a click.
One thing is not verified: Google's help pages do not say whether Google
accepts such a release from an app it has not reviewed yet, and one report
from 2026 says it does not. If Google refuses the next build for that
reason ("Only releases with status draft may be created on draft app"), the
developer side sends the same build again as a draft (no new
build is used) and the owner starts its rollout as below.

For a draft release:

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

> **The encryption question is answered in the app.** Every build tells
> Apple that the app uses no encryption of its own (only the iPhone's: the
> secure connection and the Keychain), so App Store Connect does not ask the
> export-compliance question and TestFlight does not hold the build as
> "Missing Compliance". This is on the main line (checked on 21 November
> 2026: the resolved configuration has `ITSAppUsesNonExemptEncryption`
> set to false).

**Why the owner has to do this once.** The team account already holds the
company's Apple distribution certificate (serial
`1D30B999373BB96036B3EF8590991BA`, team `6MQVM5UNDL`, valid until
31 October 2027) and the App Store Connect API key `8A673478NB`. Neither is
attached to `com.yuntera.shop` yet. Expo's tool attaches them, registers
the identifier with Apple and makes the App Store provisioning profile only
in an interactive run, after an Apple sign-in; without questions it stops
with _"Credentials are not set up. Run this command again in interactive
mode."_ (tried on 21 November 2026; no build was started). The same run
also creates the app's record in App Store Connect, which Expo's tool can
only do with an Apple sign-in, not with the API key.

**One command does all of it**, reusing the certificate and the key: it
registers the identifier, makes the profile, builds the app on Expo's
servers, creates the app record and uploads the build to TestFlight. After
that the developer side builds and uploads every later version alone.

> A browser-only route (register the identifier and make the profile on
> developer.apple.com, create the app record in App Store Connect) is not
> shorter: Expo documents no way to attach a profile to a project on its
> website, only through the same command-line tool, and that needs the
> certificate's `.p12` file and password, which only Expo holds. It is
> more clicks and more places to get an identifier wrong. Use the command.

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

In a terminal, from a copy (clone) of the Yuntera repository, at commit
`3f251c3`: the code the hosted preview and the Android build run, so both
stores carry the same code until the preview is updated. On a Mac or Linux:

```bash
git checkout 3f251c3
corepack enable
pnpm install
cd apps/shop-native
npx eas-cli@latest login
EXPO_APPLE_TEAM_ID=6MQVM5UNDL npx eas-cli@latest build --platform ios --profile production --auto-submit
```

`git checkout 3f251c3` leaves the copy on that commit alone ("detached"),
which is expected. On Windows (PowerShell), the last line is instead:

```powershell
$env:EXPO_APPLE_TEAM_ID="6MQVM5UNDL"; npx eas-cli@latest build --platform ios --profile production --auto-submit
```

`EXPO_APPLE_TEAM_ID` picks the company's Apple team, so the tool does not
ask which team. `login` asks for the Expo account's e-mail and password.
The build command then asks these questions, in this order (taken from the
tool's own code, version 27.11; wording may differ slightly in a later
version):

| Question                                                                                                         | Answer                                                        |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Do you want to log in to your Apple account?                                                                     | **Yes**                                                       |
| Apple ID / Password                                                                                              | the owner's Apple ID and its password                         |
| The six-digit code                                                                                               | the code Apple shows on the owner's iPhone or Mac (or by SMS) |
| Reuse this distribution certificate? (serial `1D30B999…91BA`)                                                    | **Yes**                                                       |
| _(the build starts; the tool says it is ensuring the app exists in App Store Connect and creates it, see below)_ | no question                                                   |
| Reuse this App Store Connect API Key? (Key ID `8A673478NB`)                                                      | **Yes**                                                       |

There is no question about the provisioning profile (it is made without
asking) nor about push notifications (turned off in `eas.json`). The
identifier `com.yuntera.shop` is registered with Apple without a question.
If the tool asks for the Apple ID and code a second time before creating
the app record, give them again.

If the tool asks instead **"Select the App Store Connect Api Key to use for
your project"**, choose **[Choose an existing key]** and then the key
`8A673478NB`. **Never** choose **[Add a new key]** or **[Add a new
certificate]**, and never answer **No** to "Reuse this distribution
certificate?": the company's other app uses the same certificate and key.
If the certificate is not offered, stop with **Ctrl+C** and tell the
developer side.

When it ensures the app exists in App Store Connect, it creates the app record **Yuntera** (primary language
Spanish (Mexico), the Latin American Spanish App Store Connect offers) and
an internal TestFlight group called **Team (Expo)** to which it invites the
team's **Admin** users. If the name "Yuntera" is already taken in the App
Store, it stops there; tell the developer side.

The build then runs on Expo's servers (about 15 to 30 minutes) and is sent
to App Store Connect by itself; the terminal can be closed once it shows
the build's and the submission's addresses. Apple processes the upload for
another 10 to 15 minutes. This build counts as one of the month's iOS
builds on Expo's free plan (15 a month).

### Add testers

App Store Connect > **Apps** > **Yuntera** > **TestFlight** > **Team
(Expo)** (or a new group: the **+** next to **Internal Testing**, a name,
**Create**). Then the **+** next to **Testers**, tick the testers, **Add**.
They receive an e-mail and install the app from TestFlight.

### Send the developer side the app's Apple ID number

App Store Connect > **Apps** > **Yuntera** > **App Information** > under
**General Information**, **Apple ID** (a number such as `6740000000`). Send
it to the developer side. It goes into `apps/shop-native/eas.json`, as
`"ascAppId"` in `submit.production.ios`, and is not secret. Done on
24 November 2026: the number is `6838560774`.

### What the developer side then does alone

With the certificate, profile and key attached to `com.yuntera.shop` and
`ascAppId` in `eas.json`, both commands run without questions:

```bash
cd apps/shop-native
npx eas-cli build --platform ios --profile production --non-interactive
npx eas-cli submit --platform ios --profile production --id <build id> --non-interactive --no-auto-testflight-setup
```

`--no-auto-testflight-setup` keeps the tool from creating TestFlight groups
or inviting anyone; the owner manages testers.

## The seller, driver and warehouse apps

Yuntera Vende, Yuntera Ruta and Yuntera Bodega follow the same path as the
shopper app, once each has been built for a phone (none has yet):

- **One app per store and identifier.** Each needs its own app in Google Play
  Console (Part 1, step 1) and in App Store Connect, under its own
  identifier: `com.yuntera.vende`, `com.yuntera.ruta` and `com.yuntera.bodega`.
  An identifier can never change after the first upload.
- **One Expo project each**, in the company's Expo team account
  (`raulea07s-team`, already named as `owner` in each app's `app.config.ts`).
  The developer side runs `eas init` in each app's directory and copies the
  project id into that app's `app.config.ts`, as for the shopper app; each
  project then needs its own Google service-account key upload (Part 1, step
  5) and its own iOS credentials.
- **The drivers' app uses location while a route runs, with the screen off.**
  Google Play asks, in **App content**, for the foreground service
  permissions declaration: what the location service does (sharing the
  position during the route in progress) and a short video of it in use. The
  app does not ask for background location, so Play's separate
  background-location declaration should not apply; Play Console says so when
  the first build is uploaded. Apple's
  review asks why the app uses the location background mode; the answer is
  the same, and App Store Connect's privacy questions must say that precise
  location is collected and linked to the driver. The app asks only for
  location "while using the app", never "always", and for notifications on
  Android 13 and later only to show the notice while the position is shared.

## Afterwards

- **Owner:** add or remove testers in Play Console and in the TestFlight
  group. For Android, start the rollout of a release only when the developer
  side says a build arrived as a draft (Part 1, step 7).
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
- **Only the shopper app** is ready for store testing. The other three need
  their Expo projects, store apps and a first build (above).
