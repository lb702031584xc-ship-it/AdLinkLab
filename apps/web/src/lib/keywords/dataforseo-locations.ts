/**
 * DataForSEO 关键词流水线：国家（location_code）与语言选项。
 * location_code 与 API 侧品牌广告数 LOCATION_CODES 同一口径（DataForSEO 官方代码）。
 */
export interface DfsLocation {
  /** 两位国家码（界面用） */
  country: string;
  /** DataForSEO location_code */
  locationCode: number;
  nameZh: string;
  nameEn: string;
  /** 该国默认搜索语言（语言选“跟随国家”时用） */
  defaultLanguage: string;
}

export const DFS_LOCATIONS: DfsLocation[] = [
  { country: "US", locationCode: 2840, nameZh: "美国", nameEn: "United States", defaultLanguage: "en" },
  { country: "GB", locationCode: 2826, nameZh: "英国", nameEn: "United Kingdom", defaultLanguage: "en" },
  { country: "CA", locationCode: 2124, nameZh: "加拿大", nameEn: "Canada", defaultLanguage: "en" },
  { country: "AU", locationCode: 2036, nameZh: "澳大利亚", nameEn: "Australia", defaultLanguage: "en" },
  { country: "DE", locationCode: 2276, nameZh: "德国", nameEn: "Germany", defaultLanguage: "de" },
  { country: "FR", locationCode: 2250, nameZh: "法国", nameEn: "France", defaultLanguage: "fr" },
  { country: "ES", locationCode: 2724, nameZh: "西班牙", nameEn: "Spain", defaultLanguage: "es" },
  { country: "IT", locationCode: 2380, nameZh: "意大利", nameEn: "Italy", defaultLanguage: "it" },
  { country: "NL", locationCode: 2528, nameZh: "荷兰", nameEn: "Netherlands", defaultLanguage: "nl" },
  { country: "MX", locationCode: 2484, nameZh: "墨西哥", nameEn: "Mexico", defaultLanguage: "es" },
  { country: "JP", locationCode: 2392, nameZh: "日本", nameEn: "Japan", defaultLanguage: "ja" },
  { country: "BR", locationCode: 2076, nameZh: "巴西", nameEn: "Brazil", defaultLanguage: "pt" },
];

/** 语言覆盖选项（value 为 DataForSEO language_code）。 */
export const DFS_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
];
