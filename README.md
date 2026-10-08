# TAGGY legal pages

Public Privacy Policy and Terms of Service for TAGGY's Discord bot, fishing app and dashboard, operated by **kli, Switzerland**.

- `index.html`: legal document links and contact details.
- `privacy.html`: information processing, operator/staff access, retention and privacy requests.
- `terms.html`: usage rules, server management, tickets, verification, security and fishing.
- `legal.css`: shared responsive styling and print layout. No external scripts, fonts, images or cookies.

Contact: **zzzzzworks@gmail.com**. Last updated: **October 8, 2026**.

## Publish

1. Extract `TAGGY-policy-update-2026-10-04.zip`.
2. Open [lojjkli/taggy](https://github.com/lojjkli/taggy) on GitHub and select the `main` branch.
3. Select **Add file > Upload files**.
4. Drag in `index.html`, `privacy.html`, `terms.html`, `legal.css` and `README.md` together. Upload the files directly into the repository root, without an extra folder.
5. Enter **Update TAGGY privacy policy and terms** as the commit message and choose **Commit changes**.
6. Wait for the repository's Pages deployment to finish under **Actions**, then open both published pages below to check the new October 4, 2026 date.

The existing public document URLs returned HTTP 200 during preparation:

- Privacy Policy: [https://lojjkli.github.io/taggy/privacy.html](https://lojjkli.github.io/taggy/privacy.html)
- Terms of Service: [https://lojjkli.github.io/taggy/terms.html](https://lojjkli.github.io/taggy/terms.html)

Use these addresses for the Privacy Policy and Terms of Service fields in the Discord Developer Portal. Keeping the filenames preserves the existing links. Link the same public pages from the TAGGY homepage/dashboard so users can find them. These are website files; they do not go in the bot-hosting container.

## Operator notes

The text reflects the current source for TAGGY's upgraded bot and dashboard. Keep it accurate when deploying a different version or changing data practices. The operator confirmed the business name, Swiss location and contact email. Confirm and document the bot host's actual storage/backup regions and all provider transfer arrangements; business location alone does not establish hosting location. Add the confirmed destination countries and safeguards to the international-processing section as applicable.

Deletion requests require operator action. Removing TAGGY from a server, deleting a ticket channel, signing out or unlinking Roblox is not a full data erasure procedure. Review the bot-held DM cache, questionnaire answers, verification records, security incidents, fishing profile and related feature state when fulfilling a request. Handle Discord messages/transcripts that remain under your control separately; staff downloads may be outside your control. Do not re-import a deleted person's DM history without a valid feature purpose and their request or permission.

The bot code alone does not prove encryption of hosting disks/backups or establish provider contract safeguards. Verify those deployment arrangements rather than adding unsupported encryption or compliance claims to the public policy.

## Sources checked

- [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
- [Discord Developer Terms, privacy/security and data deletion](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service)
- [Swiss FDPIC guidance on the duty to provide information](https://www.edoeb.admin.ch/en/duty-to-provide-information)
- [Swiss FDPIC guidance on cross-border transfers](https://www.edoeb.admin.ch/en/cross-border-transfer-of-personal-data)

These source links support drafting and maintenance. The pages describe TAGGY's actual behavior; they do not certify every legal or hosting requirement has been satisfied.

Dish washing, added 8 October 2026, has separate game state. Include washing-state.json when fulfilling game-profile data or deletion requests. Dish washing rankings show Discord IDs/mentions and cleaning totals; the privacy policy and terms cover these uses.
