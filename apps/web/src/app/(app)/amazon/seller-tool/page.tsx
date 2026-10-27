import { SellerToolClient } from "@/components/amazon/seller-tool-client";

export const dynamic = "force-dynamic";

/**
 * 卖家桌面工具 P0 的网页版：选品潜力库 + 筛选模板 + 利润门 + IP 标签。
 * 纯浏览器端工具：不调任何 API、不写数据库、不爬取亚马逊，
 * 数据只存在浏览器 localStorage；阈值全部可在页面上改。
 * 直接访问地址：/amazon/seller-tool（需先登录 AdLinkLab）。
 */
export default function AmazonSellerToolPage() {
  return <SellerToolClient />;
}
