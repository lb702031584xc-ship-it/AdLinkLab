import { zh as commonZh, en as commonEn } from "./dict/common";
import { zh as dashboardZh, en as dashboardEn } from "./dict/dashboard";
import { zh as integrationsZh, en as integrationsEn } from "./dict/integrations";
import { zh as entitiesZh, en as entitiesEn } from "./dict/entities";
import { zh as opsZh, en as opsEn } from "./dict/ops";
import { zh as authZh, en as authEn } from "./dict/auth";
import { zh as aiZh, en as aiEn } from "./dict/ai";
import { zh as experimentZh, en as experimentEn } from "./dict/experiment";
import { zh as budgetZh, en as budgetEn } from "./dict/budget";
import { zh as researchZh, en as researchEn } from "./dict/research";
import { zh as strategyZh, en as strategyEn } from "./dict/strategy";
import { zh as linkSwapZh, en as linkSwapEn } from "./dict/link-swap";
import { zh as campaignToggleZh, en as campaignToggleEn } from "./dict/campaign-toggle";
import { zh as adsAutoZh, en as adsAutoEn } from "./dict/ads-auto";
import { zh as cashbackZh, en as cashbackEn } from "./dict/cashback";
import { zh as testClickZh, en as testClickEn } from "./dict/test-click";
import { zh as deadLinkZh, en as deadLinkEn } from "./dict/dead-link";
import { zh as searchTermsZh, en as searchTermsEn } from "./dict/search-terms";
import { zh as payoutWatchZh, en as payoutWatchEn } from "./dict/payout-watch";
import { zh as budgetRulesZh, en as budgetRulesEn } from "./dict/budget-rules";
import { zh as lpOptimizationZh, en as lpOptimizationEn } from "./dict/lp-optimization";
import { zh as launchZh, en as launchEn } from "./dict/launch";
import { zh as quickstartZh, en as quickstartEn } from "./dict/quickstart";
import { zh as coachZh, en as coachEn } from "./dict/coach";
import { zh as keywordStarterZh, en as keywordStarterEn } from "./dict/keyword-starter";
import { zh as networksZh, en as networksEn } from "./dict/networks";
import { zh as weeklyReportZh, en as weeklyReportEn } from "./dict/weekly-report";
import { zh as launchArchiveZh, en as launchArchiveEn } from "./dict/launch-archive";
import { zh as cashbackRateWatchZh, en as cashbackRateWatchEn } from "./dict/cashback-rate-watch";
import { zh as cashbackTermsWatchZh, en as cashbackTermsWatchEn } from "./dict/cashback-terms-watch";
import { zh as cashbackLpScoreZh, en as cashbackLpScoreEn } from "./dict/cashback-lp-score";
import { zh as cashbackRedirectCheckZh, en as cashbackRedirectCheckEn } from "./dict/cashback-redirect-check";
import { zh as cashbackRateCompareZh, en as cashbackRateCompareEn } from "./dict/cashback-rate-compare";
import { zh as catalogZh, en as catalogEn } from "./dict/catalog";

export type Lang = "zh" | "en";

/** Cookie that persists the user's language choice. */
export const LANG_COOKIE = "adlinklab-lang";

/** Default language for first-time visitors. */
export const DEFAULT_LANG: Lang = "zh";

export const dictionaries = {
  zh: {
    common: commonZh,
    dashboard: dashboardZh,
    integrations: integrationsZh,
    entities: entitiesZh,
    ops: opsZh,
    auth: authZh,
    ai: aiZh,
    experiment: experimentZh,
    budget: budgetZh,
    research: researchZh,
    strategy: strategyZh,
    linkSwap: linkSwapZh,
    campaignToggle: campaignToggleZh,
    adsAuto: adsAutoZh,
    cashback: cashbackZh,
    testClick: testClickZh,
    deadLink: deadLinkZh,
    searchTerms: searchTermsZh,
    payoutWatch: payoutWatchZh,
    budgetRules: budgetRulesZh,
    lpOptimization: lpOptimizationZh,
    launch: launchZh,
    quickstart: quickstartZh,
    coach: coachZh,
    keywordStarter: keywordStarterZh,
    networks: networksZh,
    weeklyReport: weeklyReportZh,
    launchArchive: launchArchiveZh,
    cashbackRateWatch: cashbackRateWatchZh,
    cashbackTermsWatch: cashbackTermsWatchZh,
    cashbackLpScore: cashbackLpScoreZh,
    cashbackRedirectCheck: cashbackRedirectCheckZh,
    cashbackRateCompare: cashbackRateCompareZh,
    catalog: catalogZh,
  },
  en: {
    common: commonEn,
    dashboard: dashboardEn,
    integrations: integrationsEn,
    entities: entitiesEn,
    ops: opsEn,
    auth: authEn,
    ai: aiEn,
    experiment: experimentEn,
    budget: budgetEn,
    research: researchEn,
    strategy: strategyEn,
    linkSwap: linkSwapEn,
    campaignToggle: campaignToggleEn,
    adsAuto: adsAutoEn,
    cashback: cashbackEn,
    testClick: testClickEn,
    deadLink: deadLinkEn,
    searchTerms: searchTermsEn,
    payoutWatch: payoutWatchEn,
    budgetRules: budgetRulesEn,
    lpOptimization: lpOptimizationEn,
    launch: launchEn,
    quickstart: quickstartEn,
    coach: coachEn,
    keywordStarter: keywordStarterEn,
    networks: networksEn,
    weeklyReport: weeklyReportEn,
    launchArchive: launchArchiveEn,
    cashbackRateWatch: cashbackRateWatchEn,
    cashbackTermsWatch: cashbackTermsWatchEn,
    cashbackLpScore: cashbackLpScoreEn,
    cashbackRedirectCheck: cashbackRedirectCheckEn,
    cashbackRateCompare: cashbackRateCompareEn,
    catalog: catalogEn,
  },
};

export type Dict = typeof dictionaries.zh;

export function getDictionary(lang: Lang): Dict {
  return dictionaries[lang] ?? dictionaries[DEFAULT_LANG];
}
