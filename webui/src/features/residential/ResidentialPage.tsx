import { useQuery } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { AlertTriangle, Eraser, Home, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { DataTable } from "../../components/ui/DataTable";
import { Input } from "../../components/ui/Input";
import { OffsetPagination } from "../../components/ui/OffsetPagination";
import { Select } from "../../components/ui/Select";
import { useI18n } from "../../i18n";
import { formatApiErrorMessage } from "../../lib/error-message";
import { formatDateTime, formatRelativeTime } from "../../lib/time";
import { listNodes } from "../nodes/api";
import { getAllRegions, getRegionName } from "../nodes/regions";
import type { NodeSummary } from "../nodes/types";
import { listPlatforms } from "../platforms/api";
import type { Platform } from "../platforms/types";
import { listSubscriptions } from "../subscriptions/api";
import { getResidentialState } from "./api";
import type { ResidentialEntry } from "./types";

type ResidentialFilter = "all" | "yes" | "no" | "unknown";
type StatusFilter = "all" | "healthy" | "circuit_open" | "error" | "disabled";
type SourceFilter = "all" | "ip-api" | "ippure";

const EMPTY_PLATFORMS: Platform[] = [];

type ResidentialRow = NodeSummary & {
  residential?: ResidentialEntry;
};

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 1000, 2000, 5000] as const;
const FILTER_ITEM_STYLE: CSSProperties = {
  flex: "1 1 120px",
  minWidth: "80px",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};
const FILTER_CONTROL_STYLE: CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  fontSize: "0.875rem",
  minHeight: "32px",
  height: "32px",
};

function firstTag(node: NodeSummary): string {
  if (node.display_tag && node.display_tag.trim()) {
    return node.display_tag;
  }
  if (!node.tags.length) {
    return "-";
  }
  return node.tags[0].tag;
}

function regionToFlag(region: string | undefined): string {
  if (!region || region.length !== 2) {
    return region || "-";
  }
  const code = region.toUpperCase();
  const flag = String.fromCodePoint(...[...code].map((c) => c.charCodeAt(0) + 127397));
  const name = getRegionName(code);
  return name ? `${flag} ${code} (${name})` : `${flag} ${code}`;
}

function residentialKind(entry: ResidentialEntry | undefined): ResidentialFilter {
  if (!entry || entry.residential === null || entry.residential === undefined) {
    return "unknown";
  }
  return entry.residential ? "yes" : "no";
}

function nodeStatus(node: NodeSummary): "healthy" | "circuit_open" | "pending_test" | "error" | "disabled" {
  if (!node.enabled) {
    return "disabled";
  }
  if (!node.has_outbound) {
    return "error";
  }
  if (node.circuit_open_since && node.failure_count === 0) {
    return "pending_test";
  }
  if (node.circuit_open_since) {
    return "circuit_open";
  }
  return "healthy";
}

function fraudColor(fraud: number): string {
  if (fraud <= 30) {
    return "var(--success)";
  }
  if (fraud <= 70) {
    return "var(--warning)";
  }
  return "var(--danger)";
}

export function ResidentialPage() {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("");
  const [residentialFilter, setResidentialFilter] = useState<ResidentialFilter>("all");
  const [platformId, setPlatformId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [egressIp, setEgressIp] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(200);

  const allRegions = getAllRegions();

  const platformsQuery = useQuery({
    queryKey: ["platforms", "all"],
    queryFn: async () => {
      const data = await listPlatforms({ limit: 100000, offset: 0 });
      return data.items;
    },
    staleTime: 60_000,
  });
  const platforms = platformsQuery.data ?? EMPTY_PLATFORMS;

  const subscriptionsQuery = useQuery({
    queryKey: ["subscriptions", "all"],
    queryFn: async () => {
      const data = await listSubscriptions({ limit: 100000, offset: 0 });
      return data.items;
    },
    staleTime: 60_000,
  });
  const subscriptions = subscriptionsQuery.data ?? [];

  const nodesQuery = useQuery({
    queryKey: ["residential", "nodes", platformId, subscriptionId, egressIp],
    queryFn: () =>
      listNodes({
        limit: 100000,
        offset: 0,
        sort_by: "region",
        sort_order: "asc",
        platform_id: platformId || undefined,
        subscription_id: subscriptionId || undefined,
        egress_ip: egressIp || undefined,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const stateQuery = useQuery({
    queryKey: ["residential", "state"],
    queryFn: getResidentialState,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const rows: ResidentialRow[] = useMemo(() => {
    const nodes = nodesQuery.data?.items ?? [];
    const items = stateQuery.data?.items ?? {};
    return nodes
      .filter((node) => Boolean(node.egress_ip))
      .map((node) => ({ ...node, residential: items[node.egress_ip as string] }));
  }, [nodesQuery.data, stateQuery.data]);

  const counts = useMemo(() => {
    let yes = 0;
    let no = 0;
    let unknown = 0;
    for (const row of rows) {
      const kind = residentialKind(row.residential);
      if (kind === "yes") yes += 1;
      else if (kind === "no") no += 1;
      else unknown += 1;
    }
    return { yes, no, unknown };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const keywordLower = keyword.trim().toLowerCase();
    const regionUpper = region.trim().toUpperCase();
    return rows.filter((row) => {
      if (keywordLower && !firstTag(row).toLowerCase().includes(keywordLower)) {
        return false;
      }
      if (regionUpper && (row.region ?? "").toUpperCase() !== regionUpper) {
        return false;
      }
      if (residentialFilter !== "all" && residentialKind(row.residential) !== residentialFilter) {
        return false;
      }
      if (sourceFilter !== "all" && (row.residential?.source || "") !== sourceFilter) {
        return false;
      }
      if (statusFilter !== "all") {
        const status = nodeStatus(row);
        if (statusFilter === "circuit_open") {
          if (status !== "circuit_open" && status !== "pending_test") {
            return false;
          }
        } else if (status !== statusFilter) {
          return false;
        }
      }
      return true;
    });
  }, [rows, keyword, region, residentialFilter, sourceFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = useMemo(
    () => filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filteredRows, safePage, pageSize]
  );

  const resetFilters = () => {
    setKeyword("");
    setRegion("");
    setResidentialFilter("all");
    setPlatformId("");
    setSubscriptionId("");
    setEgressIp("");
    setStatusFilter("all");
    setSourceFilter("all");
    setPage(0);
  };

  const refresh = async () => {
    await Promise.all([nodesQuery.refetch(), stateQuery.refetch()]);
  };

  const col = createColumnHelper<ResidentialRow>();

  const columns = [
    col.accessor((row) => firstTag(row), {
      id: "tag",
      header: t("节点名"),
      cell: (info) => (
        <div className="nodes-tag-cell">
          <span title={info.getValue() as string}>{info.getValue() as string}</span>
        </div>
      ),
    }),
    col.accessor("region", {
      header: t("区域"),
      cell: (info) => {
        const val = regionToFlag(info.getValue());
        return (
          <div style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={val}>
            {val}
          </div>
        );
      },
    }),
    col.accessor("egress_ip", {
      header: t("出口 IP"),
      cell: (info) => {
        const val = info.getValue() || "-";
        return (
          <div style={{ maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={val}>
            {val}
          </div>
        );
      },
    }),
    col.display({
      id: "residential",
      header: t("家宽"),
      cell: (info) => {
        const kind = residentialKind(info.row.original.residential);
        if (kind === "yes") return <Badge variant="success">{t("是")}</Badge>;
        if (kind === "no") return <Badge variant="neutral">{t("否")}</Badge>;
        return <Badge variant="muted">{t("未知")}</Badge>;
      },
    }),
    col.display({
      id: "fraud",
      header: t("评分"),
      cell: (info) => {
        const fraud = info.row.original.residential?.fraud;
        if (typeof fraud !== "number") {
          return "-";
        }
        return <span style={{ color: fraudColor(fraud), fontWeight: 600 }}>{fraud}</span>;
      },
    }),
    col.display({
      id: "isp",
      header: t("运营商"),
      cell: (info) => {
        const isp = info.row.original.residential?.isp;
        if (!isp) return "-";
        return (
          <div style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={isp}>
            {isp}
          </div>
        );
      },
    }),
    col.display({
      id: "source",
      header: t("来源"),
      cell: (info) => info.row.original.residential?.source || "-",
    }),
    col.display({
      id: "detected_at",
      header: t("检测时间"),
      cell: (info) => {
        const ts = info.row.original.residential?.ts;
        if (!ts) return "-";
        return <span title={formatDateTime(ts)}>{formatRelativeTime(ts)}</span>;
      },
    }),
    col.accessor("last_latency_probe_attempt", {
      header: t("上次探测"),
      cell: (info) => {
        const val = info.getValue();
        if (!val) return "-";
        return <span title={formatDateTime(val)}>{formatRelativeTime(val)}</span>;
      },
    }),
    col.display({
      id: "reference_latency_ms",
      header: t("参考延迟"),
      cell: (info) => {
        const node = info.row.original;
        if (nodeStatus(node) !== "healthy" || typeof node.reference_latency_ms !== "number") {
          return "-";
        }
        return `${node.reference_latency_ms.toFixed(0)} ms`;
      },
    }),
    col.display({
      id: "status",
      header: t("状态"),
      cell: (info) => {
        const status = nodeStatus(info.row.original);
        if (status === "disabled") return <Badge variant="neutral">{t("禁用")}</Badge>;
        if (status === "error") return <Badge variant="danger">{t("错误")}</Badge>;
        if (status === "pending_test") return <Badge variant="muted">{t("待测")}</Badge>;
        if (status === "circuit_open") return <Badge variant="warning">{t("熔断")}</Badge>;
        return <Badge variant="success">{t("健康")}</Badge>;
      },
    }),
  ];

  const isLoading = nodesQuery.isLoading || stateQuery.isLoading;
  const error = nodesQuery.error ?? stateQuery.error;

  return (
    <section className="nodes-page">
      <header className="module-header">
        <div>
          <h2>{t("ip 检测")}</h2>
          <p className="module-description">{t("按出口 IP 关联住宅检测结果，查看节点是否为家宽及其风险评分。")}</p>
        </div>
      </header>

      <Card className="filter-card platform-list-card platform-directory-card">
        <div className="list-card-header">
          <div>
            <h3>{t("住宅检测列表")}</h3>
            <p>
              {t("共 {{total}} 个节点，{{yes}} 个住宅 IP，{{unknown}} 个未知", {
                total: rows.length,
                yes: counts.yes,
                unknown: counts.unknown,
              })}
              {stateQuery.data?.updated_at
                ? ` · ${t("状态更新时间 {{time}}", { time: formatDateTime(stateQuery.data.updated_at) })}`
                : ""}
            </p>
          </div>

          <div
            className="nodes-inline-filters"
            style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}
          >
            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-keyword" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("节点名")}
              </label>
              <Input
                id="residential-keyword"
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(0);
                }}
                placeholder={t("模糊搜索")}
                style={FILTER_CONTROL_STYLE}
              />
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-region" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("区域")}
              </label>
              <Select
                id="residential-region"
                value={region}
                onChange={(event) => {
                  setRegion(event.target.value);
                  setPage(0);
                }}
                style={FILTER_CONTROL_STYLE}
              >
                <option value="">{t("全部")}</option>
                {allRegions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-platform" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("被此平台路由")}
              </label>
              <Select
                id="residential-platform"
                value={platformId}
                onChange={(event) => {
                  setPlatformId(event.target.value);
                  setPage(0);
                }}
                style={FILTER_CONTROL_STYLE}
              >
                <option value="">{t("无限制")}</option>
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-subscription" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("来自此订阅")}
              </label>
              <Select
                id="residential-subscription"
                value={subscriptionId}
                onChange={(event) => {
                  setSubscriptionId(event.target.value);
                  setPage(0);
                }}
                style={FILTER_CONTROL_STYLE}
              >
                <option value="">{t("全部")}</option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-egress-ip" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("出口 IP")}
              </label>
              <Input
                id="residential-egress-ip"
                value={egressIp}
                onChange={(event) => {
                  setEgressIp(event.target.value);
                  setPage(0);
                }}
                placeholder="IP / CIDR"
                style={FILTER_CONTROL_STYLE}
              />
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-kind" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("家宽")}
              </label>
              <Select
                id="residential-kind"
                value={residentialFilter}
                onChange={(event) => {
                  setResidentialFilter(event.target.value as ResidentialFilter);
                  setPage(0);
                }}
                style={FILTER_CONTROL_STYLE}
              >
                <option value="all">{t("全部")}</option>
                <option value="yes">{t("是")}</option>
                <option value="no">{t("否")}</option>
                <option value="unknown">{t("未知")}</option>
              </Select>
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-source" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("来源")}
              </label>
              <Select
                id="residential-source"
                value={sourceFilter}
                onChange={(event) => {
                  setSourceFilter(event.target.value as SourceFilter);
                  setPage(0);
                }}
                style={FILTER_CONTROL_STYLE}
              >
                <option value="all">{t("全部")}</option>
                <option value="ippure">ippure</option>
                <option value="ip-api">ip-api</option>
              </Select>
            </div>

            <div style={FILTER_ITEM_STYLE}>
              <label htmlFor="residential-status" style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                {t("状态")}
              </label>
              <Select
                id="residential-status"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as StatusFilter);
                  setPage(0);
                }}
                style={FILTER_CONTROL_STYLE}
              >
                <option value="all">{t("全部")}</option>
                <option value="healthy">{t("健康")}</option>
                <option value="circuit_open">{t("熔断 / 待测")}</option>
                <option value="error">{t("错误")}</option>
                <option value="disabled">{t("禁用")}</option>
              </Select>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.125rem", marginLeft: "auto" }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void refresh()}
                disabled={nodesQuery.isFetching || stateQuery.isFetching}
                style={{ minHeight: "32px", height: "32px", padding: "0 0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
              >
                <RefreshCw size={16} className={nodesQuery.isFetching || stateQuery.isFetching ? "spin" : undefined} />
                {t("刷新")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={resetFilters}
                style={{ minHeight: "32px", height: "32px", padding: "0 0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
              >
                <Eraser size={16} />
                {t("重置")}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="nodes-table-card platform-cards-container subscriptions-table-card">
        {isLoading ? <p className="muted">{t("正在加载住宅检测数据...")}</p> : null}

        {error ? (
          <div className="callout callout-error">
            <AlertTriangle size={14} />
            <span>{formatApiErrorMessage(error, t)}</span>
          </div>
        ) : null}

        {!isLoading && !filteredRows.length ? (
          <div className="empty-box">
            <Home size={16} />
            <p>{t("没有匹配的节点")}</p>
          </div>
        ) : null}

        {filteredRows.length ? (
          <DataTable data={pagedRows} columns={columns} getRowId={(row) => row.node_hash} />
        ) : null}

        <OffsetPagination
          page={safePage}
          totalPages={totalPages}
          totalItems={filteredRows.length}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
        />

        {!stateQuery.data?.count ? (
          <div className="callout callout-warning" style={{ marginTop: "0.75rem" }}>
            <Sparkles size={14} />
            <span>{t("尚未生成住宅检测状态文件，请先运行检测脚本。")}</span>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
