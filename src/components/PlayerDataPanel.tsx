/** Cross-platform player snapshot surface with refresh, partial-data, and cached-data states. */
import { AlertTriangle, BarChart3, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AppError, PlatformLink, PlayerSnapshot } from "../lib/types";

const number = (value?: number, digits = 2) =>
  value === undefined || value === null ? "未知" : value.toFixed(digits);
const percent = (value?: number) =>
  value === undefined || value === null ? "未知" : `${value.toFixed(1)}%`;
const matchResult = { win: "胜", loss: "负", tie: "平" } as const;

export function PlayerDataPanel({ link, onChanged }: { link: PlatformLink; onChanged?: () => void }) {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const perfectWorld = link.platformCode === "perfectworld";
  const platformName = perfectWorld ? "完美平台" : "5E";
  const panelTitle = `${platformName} 玩家数据`;
  const scoreLabel = perfectWorld ? "赛季记录分数" : "最近比赛后 ELO";

  const load = async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      setSnapshot(await api.playerData(link.id, forceRefresh));
      onChanged?.();
    } catch (cause) {
      setError((cause as AppError)?.message || `无法查询${panelTitle}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [link.id, link.externalId]);

  if (loading && !snapshot) {
    return (
      <section className="detail-section player-data" aria-busy="true">
        <div className="section-row">
          <h3>{panelTitle}</h3>
          <RefreshCw className="spin-icon" />
        </div>
        <div className="player-skeleton" aria-label={`正在查询 ${panelTitle}`}>
          <i />
          <i />
        </div>
      </section>
    );
  }

  if (error && !snapshot) {
    return (
      <section className="detail-section player-data">
        <div className="section-row">
          <h3>{panelTitle}</h3>
          <AlertTriangle className="warning-icon" />
        </div>
        <p className="player-message error">{error}</p>
        <button className="button secondary" onClick={() => void load(true)}>
          <RefreshCw />
          重新查询
        </button>
      </section>
    );
  }

  if (!snapshot) return null;
  return (
    <section className="detail-section player-data" aria-live="polite">
      <div className="section-row">
        <div>
          <h3>{panelTitle}</h3>
          <p className="player-subtitle">
            {snapshot.nickname || snapshot.externalId}
            {snapshot.rankName ? ` · ${snapshot.rankName}` : ""}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label={`刷新 ${panelTitle}`}
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCw className={loading ? "spin-icon" : undefined} />
        </button>
      </div>

      <div className="player-rank">
        <BarChart3 />
        <div>
          <span>{scoreLabel}</span>
          <strong>{number(snapshot.elo, 0)}</strong>
        </div>
        <small>{perfectWorld ? "按 SteamID 自动匹配" : `${snapshot.stats.sampleSize} 场样本`}</small>
      </div>

      {!perfectWorld && <dl className="player-metrics">
        <div><dt>KD</dt><dd>{number(snapshot.stats.kd)}</dd></div>
        <div><dt>Rating</dt><dd>{number(snapshot.stats.rating)}</dd></div>
        <div><dt>ADR</dt><dd>{number(snapshot.stats.adr, 1)}</dd></div>
        <div><dt>爆头率</dt><dd>{percent(snapshot.stats.headshotRate)}</dd></div>
        <div><dt>胜率</dt><dd>{percent(snapshot.stats.winRate)}</dd></div>
      </dl>}

      {(snapshot.stale || snapshot.warnings.length > 0) && (
        <div className="player-warnings">
          {snapshot.stale && <strong>缓存数据</strong>}
          {snapshot.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {!perfectWorld && <><div className="player-match-heading">
        <strong>最近比赛</strong>
        <span>{new Date(snapshot.fetchedAt).toLocaleString("zh-CN")} 更新</span>
      </div>
      {snapshot.recentMatches.length ? (
        <div className="player-match-list">
          {snapshot.recentMatches.map((match) => (
            <article key={match.matchId}>
              <span className={`match-result ${match.result || "unknown"}`}>
                {match.result ? matchResult[match.result] : "?"}
              </span>
              <div>
                <strong>{match.map || "未知地图"}</strong>
                <small>
                  {match.occurredAt
                    ? new Date(match.occurredAt).toLocaleDateString("zh-CN")
                    : "时间未知"}
                  {match.score ? ` · ${match.score}` : ""}
                </small>
              </div>
              <span className="match-kda">
                {match.kills ?? "-"} / {match.deaths ?? "-"} / {match.assists ?? "-"}
              </span>
              <small>R {number(match.rating)} · ADR {number(match.adr, 1)}</small>
            </article>
          ))}
        </div>
      ) : (
        <p className="player-message">最近 180 天没有可显示的 CS2 比赛。</p>
      )}</>}
    </section>
  );
}
