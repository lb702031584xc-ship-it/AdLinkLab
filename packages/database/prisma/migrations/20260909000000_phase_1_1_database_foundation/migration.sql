-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "AdGroupStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CriterionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT');

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT');

-- CreateEnum
CREATE TYPE "TrackingLinkStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DRAFT');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'ATTRIBUTED', 'UPLOADED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GoogleUploadStatus" AS ENUM ('NOT_UPLOADED', 'QUEUED', 'UPLOADED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UrlVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "UrlChangeRequestStatus" AS ENUM ('DRAFT', 'VALIDATED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UrlEntityType" AS ENUM ('CUSTOMER', 'CAMPAIGN', 'AD_GROUP', 'AD', 'AD_GROUP_CRITERION');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DISABLED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "manager_customer_id" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "oauth_credential_ref" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "google_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "google_account_id" UUID NOT NULL,
    "google_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "google_ad_group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AdGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ad_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad_group_id" UUID NOT NULL,
    "google_ad_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AdStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_group_criteria" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ad_group_id" UUID NOT NULL,
    "google_criterion_id" TEXT NOT NULL,
    "keyword" TEXT,
    "match_type" TEXT,
    "status" "CriterionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "ad_group_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "destination_url" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "campaign_id" UUID,
    "ad_id" UUID,
    "offer_id" UUID NOT NULL,
    "landing_page_id" UUID,
    "status" "TrackingLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clicks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tracking_link_id" UUID NOT NULL,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "referer" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "device_type" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "click_id" UUID NOT NULL,
    "conversion_action" TEXT NOT NULL,
    "conversion_time" TIMESTAMPTZ(3) NOT NULL,
    "value" DECIMAL(19,4),
    "currency" TEXT,
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "google_upload_status" "GoogleUploadStatus" NOT NULL DEFAULT 'NOT_UPLOADED',
    "google_conversion_resource_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "click_id" UUID,
    "conversion_id" UUID,
    "order_id" TEXT NOT NULL,
    "value" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" "UrlEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "final_url" TEXT NOT NULL,
    "final_mobile_url" TEXT,
    "final_app_url" TEXT,
    "tracking_template" TEXT,
    "custom_parameters" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL,
    "status" "UrlVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3),
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "url_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "url_change_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_type" "UrlEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_version_id" UUID,
    "to_version_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "status" "UrlChangeRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotency_key" TEXT NOT NULL,
    "job_id" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "executed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "url_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "type" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "external_account_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "job_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "request_id" TEXT,
    "job_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "google_accounts_tenant_id_idx" ON "google_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "google_accounts_user_id_idx" ON "google_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "google_accounts_customer_id_key" ON "google_accounts"("customer_id");

-- CreateIndex
CREATE INDEX "campaigns_google_account_id_idx" ON "campaigns"("google_account_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_idx" ON "campaigns"("tenant_id");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_google_account_id_google_campaign_id_key" ON "campaigns"("google_account_id", "google_campaign_id");

-- CreateIndex
CREATE INDEX "ad_groups_campaign_id_idx" ON "ad_groups"("campaign_id");

-- CreateIndex
CREATE INDEX "ad_groups_tenant_id_idx" ON "ad_groups"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_groups_campaign_id_google_ad_group_id_key" ON "ad_groups"("campaign_id", "google_ad_group_id");

-- CreateIndex
CREATE INDEX "ads_ad_group_id_idx" ON "ads"("ad_group_id");

-- CreateIndex
CREATE INDEX "ads_tenant_id_idx" ON "ads"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ads_ad_group_id_google_ad_id_key" ON "ads"("ad_group_id", "google_ad_id");

-- CreateIndex
CREATE INDEX "ad_group_criteria_ad_group_id_idx" ON "ad_group_criteria"("ad_group_id");

-- CreateIndex
CREATE INDEX "ad_group_criteria_tenant_id_idx" ON "ad_group_criteria"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_group_criteria_ad_group_id_google_criterion_id_key" ON "ad_group_criteria"("ad_group_id", "google_criterion_id");

-- CreateIndex
CREATE INDEX "offers_tenant_id_idx" ON "offers"("tenant_id");

-- CreateIndex
CREATE INDEX "offers_status_idx" ON "offers"("status");

-- CreateIndex
CREATE INDEX "landing_pages_offer_id_idx" ON "landing_pages"("offer_id");

-- CreateIndex
CREATE INDEX "landing_pages_domain_idx" ON "landing_pages"("domain");

-- CreateIndex
CREATE INDEX "landing_pages_status_idx" ON "landing_pages"("status");

-- CreateIndex
CREATE INDEX "landing_pages_tenant_id_idx" ON "landing_pages"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_public_id_key" ON "tracking_links"("public_id");

-- CreateIndex
CREATE INDEX "tracking_links_campaign_id_idx" ON "tracking_links"("campaign_id");

-- CreateIndex
CREATE INDEX "tracking_links_ad_id_idx" ON "tracking_links"("ad_id");

-- CreateIndex
CREATE INDEX "tracking_links_offer_id_idx" ON "tracking_links"("offer_id");

-- CreateIndex
CREATE INDEX "tracking_links_landing_page_id_idx" ON "tracking_links"("landing_page_id");

-- CreateIndex
CREATE INDEX "tracking_links_status_idx" ON "tracking_links"("status");

-- CreateIndex
CREATE INDEX "tracking_links_tenant_id_idx" ON "tracking_links"("tenant_id");

-- CreateIndex
CREATE INDEX "clicks_tracking_link_id_idx" ON "clicks"("tracking_link_id");

-- CreateIndex
CREATE INDEX "clicks_gclid_idx" ON "clicks"("gclid");

-- CreateIndex
CREATE INDEX "clicks_created_at_idx" ON "clicks"("created_at");

-- CreateIndex
CREATE INDEX "clicks_country_idx" ON "clicks"("country");

-- CreateIndex
CREATE INDEX "clicks_device_type_idx" ON "clicks"("device_type");

-- CreateIndex
CREATE INDEX "clicks_tenant_id_idx" ON "clicks"("tenant_id");

-- CreateIndex
CREATE INDEX "conversions_click_id_idx" ON "conversions"("click_id");

-- CreateIndex
CREATE INDEX "conversions_conversion_time_idx" ON "conversions"("conversion_time");

-- CreateIndex
CREATE INDEX "conversions_status_idx" ON "conversions"("status");

-- CreateIndex
CREATE INDEX "conversions_google_upload_status_idx" ON "conversions"("google_upload_status");

-- CreateIndex
CREATE INDEX "conversions_tenant_id_idx" ON "conversions"("tenant_id");

-- CreateIndex
CREATE INDEX "orders_click_id_idx" ON "orders"("click_id");

-- CreateIndex
CREATE INDEX "orders_conversion_id_idx" ON "orders"("conversion_id");

-- CreateIndex
CREATE INDEX "orders_order_id_idx" ON "orders"("order_id");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_order_id_key" ON "orders"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "url_versions_entity_type_entity_id_idx" ON "url_versions"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "url_versions_entity_type_entity_id_status_idx" ON "url_versions"("entity_type", "entity_id", "status");

-- CreateIndex
CREATE INDEX "url_versions_status_idx" ON "url_versions"("status");

-- CreateIndex
CREATE INDEX "url_versions_effective_at_idx" ON "url_versions"("effective_at");

-- CreateIndex
CREATE INDEX "url_versions_tenant_id_idx" ON "url_versions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "url_versions_entity_type_entity_id_version_key" ON "url_versions"("entity_type", "entity_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "url_change_requests_idempotency_key_key" ON "url_change_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "url_change_requests_entity_type_entity_id_idx" ON "url_change_requests"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "url_change_requests_status_idx" ON "url_change_requests"("status");

-- CreateIndex
CREATE INDEX "url_change_requests_scheduled_at_idx" ON "url_change_requests"("scheduled_at");

-- CreateIndex
CREATE INDEX "url_change_requests_job_id_idx" ON "url_change_requests"("job_id");

-- CreateIndex
CREATE INDEX "url_change_requests_tenant_id_idx" ON "url_change_requests"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_idempotency_key_key" ON "sync_jobs"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_job_id_key" ON "sync_jobs"("job_id");

-- CreateIndex
CREATE INDEX "sync_jobs_type_idx" ON "sync_jobs"("type");

-- CreateIndex
CREATE INDEX "sync_jobs_status_idx" ON "sync_jobs"("status");

-- CreateIndex
CREATE INDEX "sync_jobs_provider_idx" ON "sync_jobs"("provider");

-- CreateIndex
CREATE INDEX "sync_jobs_created_at_idx" ON "sync_jobs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_google_account_id_fkey" FOREIGN KEY ("google_account_id") REFERENCES "google_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_groups" ADD CONSTRAINT "ad_groups_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_group_criteria" ADD CONSTRAINT "ad_group_criteria_ad_group_id_fkey" FOREIGN KEY ("ad_group_id") REFERENCES "ad_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "landing_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "clicks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "clicks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_conversion_id_fkey" FOREIGN KEY ("conversion_id") REFERENCES "conversions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

