window.__ModuleLoader__.load({
	id: "dsh-usage-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/usage-api.ts
		/** DeepSeek Harness Connection RPC adapter for the Usage Service. */
		const RPC_CHANNEL = "/api";
		const RPC_NAMESPACE = "usage";
		/**
		* Create the only browser-side access path to the Host Usage Service.
		* @param ctx - Client Cordis context carrying the Connection service.
		* @returns named methods that send the Gateway's exact `{ args }` payload.
		*/
		function createUsageApi(ctx) {
			const connection = ctx.get("connection");
			if (connection?.rpc?.call === void 0) throw new Error("dsh-usage-panel: connection RPC service is unavailable");
			const call = async (method, args) => {
				const result = await connection.rpc.call(RPC_CHANNEL, `${RPC_NAMESPACE}/${method}`, { args });
				if (result.ok === true) return result.value;
				const code = result.error?.code ?? "unknown";
				throw new Error(`dsh-usage-panel: usage/${method} failed (${code})`);
			};
			return {
				snapshot: () => call("snapshot", {}),
				getConfig: () => call("getConfig", {}),
				setConfig: (cfg) => call("setConfig", { cfg }),
				resetLocal: () => call("resetLocal", {}),
				refresh: () => call("refresh", {})
			};
		}
		//#endregion
		//#region src/client.ts
		/**
		* DeepSeek 用量面板 — 浏览器半（静态 dsh.client web 插件，随 DSH 启动自动注入页面）。
		*
		* 面板 UI 延续原有交互，发布接线收敛为当前根包的静态 Client 插件：
		*  - RPC：所有调用集中到 usage-api adapter，经 connection.rpc.call 访问 usage/*。
		*  - CSS：styles.insert(CSS)（动态沙箱自由变量）-> injectStyles(CSS)（模块内 <style> 注入，
		*    带 data-plugin 标签，卸载时由 clientModules 认领/清理）。
		*  - 导出形态：export const inject + export function apply(ctx)（静态客户端插件契约）。
		*  - React 来自平台模块 'react'（external），不 import 任何 @deepseek-ai 值。
		*/
		const C_HIT = "#D8EAFC";
		const C_MISS = "#8FC1F7";
		const C_OUT = "#5FA7F4";
		const C_WARN = "#F59E0B";
		const RANGES = [
			{
				k: "today",
				label: "今日"
			},
			{
				k: "yesterday",
				label: "昨日"
			},
			{
				k: "week",
				label: "本周"
			},
			{
				k: "month",
				label: "本月"
			}
		];
		let api = null;
		let cssInjected = false;
		function injectStyles(css) {
			if (cssInjected || typeof document === "undefined") return;
			cssInjected = true;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-usage-panel";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		let state = {
			data: null,
			config: {
				hasToken: false,
				hasApiKey: false,
				apiKeySource: "credentials",
				tokenLength: 0,
				apiKeyLength: 0
			},
			position: "float",
			floatPos: null,
			dragging: false,
			draft: {
				token: "",
				apiKey: ""
			},
			status: "loading",
			message: null
		};
		const listeners = /* @__PURE__ */ new Set();
		function setState(patch) {
			state = Object.assign({}, state, patch);
			for (const fn of listeners) fn();
		}
		function setDraft(patch) {
			setState({ draft: Object.assign({}, state.draft, patch) });
		}
		function subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		}
		function getState() {
			return state;
		}
		let polling = false;
		async function refresh() {
			if (polling) return;
			polling = true;
			try {
				setState({
					data: await api.snapshot(),
					status: "ok",
					message: null
				});
			} catch (e) {
				setState({
					status: "error",
					message: String(e && e.message || e)
				});
			} finally {
				polling = false;
			}
		}
		async function refreshConfig() {
			try {
				const cfg = await api.getConfig();
				if (cfg && typeof cfg === "object") {
					setState({ config: cfg });
					const saved = readSaved();
					if (!cfg.hasToken && (saved.token || saved.apiKey)) api.setConfig({
						token: saved.token || "",
						apiKey: saved.apiKey || ""
					}).catch(() => {});
				}
			} catch (e) {}
		}
		function readSaved() {
			try {
				const raw = localStorage.getItem("dsh-usage.config");
				return raw ? JSON.parse(raw) : {};
			} catch (e) {
				return {};
			}
		}
		function writeSaved(patch) {
			const next = Object.assign(readSaved(), patch);
			try {
				localStorage.setItem("dsh-usage.config", JSON.stringify(next));
			} catch (e) {}
			return next;
		}
		function setPosition(pos) {
			if (pos !== "float" && pos !== "dock") return;
			writeSaved({ position: pos });
			setState({ position: pos });
		}
		function defaultFloatPos() {
			const w = window.innerWidth || 1280;
			const h = window.innerHeight || 800;
			return {
				x: Math.max(8, w - 80),
				y: Math.max(8, h - 140)
			};
		}
		function savedFloatPos() {
			const saved = readSaved();
			if (typeof saved.floatX === "number" && typeof saved.floatY === "number") return {
				x: saved.floatX,
				y: saved.floatY
			};
			return null;
		}
		function pad2(n) {
			return n < 10 ? "0" + n : "" + n;
		}
		function localDateKeyOf(d) {
			return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
		}
		function fmtInt(n) {
			return ("" + Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}
		function fmtTokens(n) {
			const v = Number(n) || 0;
			if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
			if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
			if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
			return "" + Math.round(v);
		}
		function fmtMoney(n, currency) {
			const v = Number(n) || 0;
			return (currency === "CNY" ? "¥" : "$") + v.toFixed(2);
		}
		function fmtTime(ts) {
			if (!ts) return "—";
			const d = new Date(ts);
			return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
		}
		const CSS = `
.dshup-row {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary);
  cursor: pointer; user-select: none; padding: 2px 0; flex-wrap: wrap;
}
.dshup-row:hover { color: var(--dsw-alias-label-primary); }
.dshup-title { font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.dshup-num { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshup-accent { color: var(--dsw-alias-brand-primary); font-variant-numeric: tabular-nums; }
.dshup-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.dshup-dot-ok { background: var(--dsw-alias-state-success-primary); }
.dshup-dot-warn { background: var(--dsw-alias-state-error-primary); }
.dshup-caret { opacity: .6; }
.dshup-hint { opacity: .75; font-size: 11px; }
.dshup-err { color: var(--dsw-alias-state-error-primary); margin-top: 4px; word-break: break-all; }
.dshup-form { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.dshup-form-row { flex-direction: row; }
.dshup-form label { display: flex; flex-direction: column; gap: 2px; }
.dshup-form input, .dshup-form select {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 5px 8px; font-size: 12px;
}
.dshup-btn {
  align-self: flex-start; cursor: pointer; font-size: 12px; padding: 4px 12px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
}
.dshup-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.dshup-btn-primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; font-weight: 600; }
/* floating widget (draggable) */
.dshup-float {
  position: fixed; z-index: 900; pointer-events: auto;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  cursor: grab; touch-action: none;
}
.dshup-float.dshup-dragging { cursor: grabbing; }
/* card opens toward the free space: upward/downward + leftward/rightward */
.dshup-float .dshup-card { position: absolute; }
.dshup-oc-up .dshup-card { bottom: calc(100% + 8px); }
.dshup-oc-down .dshup-card { top: calc(100% + 8px); }
.dshup-oc-left .dshup-card { right: 0; }
.dshup-oc-right .dshup-card { left: 0; }
.dshup-whale-btn {
  display: flex; align-items: center; justify-content: center;
  padding: 4px; cursor: grab; user-select: none;
}
.dshup-whale-btn svg { filter: drop-shadow(0 2px 6px rgba(0, 0, 0, .28)); }
.dshup-float.dshup-dragging .dshup-whale-btn { cursor: grabbing; }
.dshup-whale { position: relative; display: flex; align-items: center; flex: none; }
.dshup-whale .dshup-dot {
  position: absolute; right: -2px; bottom: -1px; width: 10px; height: 10px;
  border: 2px solid var(--dsw-alias-bg-base);
}
.dshup-card {
  padding: 12px 14px; border-radius: 12px; width: min(480px, calc(100vw - 32px));
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .18); max-height: min(80vh, 720px); overflow: auto;
}
/* ---- dashboard panel ---- */
.dshup-panel { display: flex; flex-direction: column; gap: 12px; padding: 6px 4px 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshup-ranges { display: flex; gap: 6px; padding: 4px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.dshup-range {
  flex: 1; cursor: pointer; border: none; background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; padding: 6px 0; border-radius: 8px; font-weight: 500;
}
.dshup-range:hover { color: var(--dsw-alias-label-primary); }
.dshup-range-on { background: var(--dsw-alias-brand-primary); color: #fff !important; }
.dshup-hero {
  display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border-radius: 12px;
  background: linear-gradient(135deg, rgba(77, 107, 254, .18), rgba(139, 92, 246, .08));
  border: 1px solid var(--dsw-alias-border-l1);
}
.dshup-hero-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dshup-hero-num { font-size: 26px; font-weight: 700; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; line-height: 1.1; }
.dshup-chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.dshup-chip {
  display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); min-width: 0;
}
.dshup-chip-ic { display: flex; color: var(--dsw-alias-label-secondary); }
.dshup-chip b { font-size: 13.5px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshup-chip span:last-child { font-size: 10.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dshup-sec { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.dshup-sec-ic { display: flex; color: var(--dsw-alias-brand-primary); }
.dshup-head { display: flex; align-items: center; gap: 8px; }
.dshup-head-title { font-weight: 700; font-size: 13px; color: var(--dsw-alias-label-primary); }
.dshup-head-spacer { flex: 1; }
.dshup-gear { display: flex; align-items: center; justify-content: center; cursor: pointer; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 5px; color: var(--dsw-alias-label-secondary); }
.dshup-gear:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dshup-helpzone { position: relative; display: inline-flex; align-items: center; }
.dshup-help { display: flex; align-items: center; justify-content: center; cursor: pointer; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 700; line-height: 1; padding: 0; }
.dshup-help:hover { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dshup-tutorial { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; width: 300px; max-width: calc(100vw - 60px); padding: 10px 12px; border-radius: 10px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); display: flex; flex-direction: column; gap: 4px; }
.dshup-tutorial-title { font-weight: 700; font-size: 12px; color: var(--dsw-alias-label-primary); margin-bottom: 2px; }
.dshup-step { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dshup-step b { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-brand-primary); color: #fff; font-size: 10px; margin-right: 4px; }
.dshup-badge { margin-left: auto; font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.dshup-meters { display: flex; flex-direction: column; gap: 12px; padding: 0 16px; }
.dshup-meter { display: flex; flex-direction: column; gap: 6px; }
.dshup-meter-top { display: flex; justify-content: space-between; font-size: 11.5px; gap: 12px; }
.dshup-meter-label { color: var(--dsw-alias-label-secondary); }
.dshup-meter-val { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshup-meter-track { height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); overflow: hidden; }
.dshup-meter-fill { height: 100%; border-radius: 999px; transition: width .3s; }
.dshup-chart { padding: 12px 14px 8px; border-radius: 12px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.dshup-chart-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); margin-bottom: 8px; }
.dshup-axis { font-size: 8px; fill: var(--dsw-alias-label-secondary); }
.dshup-legend { display: flex; gap: 12px; font-size: 10px; color: var(--dsw-alias-label-secondary); align-items: center; }
.dshup-legend span { display: inline-flex; align-items: center; gap: 4px; }
.dshup-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.dshup-models { display: flex; flex-direction: column; gap: 14px; padding: 0 16px; }
.dshup-model { display: flex; flex-direction: column; gap: 6px; }
.dshup-model-head { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; }
.dshup-model-name { color: var(--dsw-alias-label-primary); max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshup-model-track { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); overflow: hidden; }
.dshup-model-fill { height: 100%; background: linear-gradient(90deg, #4D6BFE, #8B5CF6); border-radius: 999px; }
.dshup-model-meta { display: flex; gap: 14px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dshup-model-meta span { display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums; }
.dshup-cta {
  display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 12px;
  border: 1px dashed var(--dsw-alias-brand-primary); background: rgba(77, 107, 254, .08);
}
.dshup-cta-ic { display: flex; color: var(--dsw-alias-brand-primary); flex: none; }
.dshup-cta-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dshup-cta-body b { font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.dshup-cta-body span { font-size: 11px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.dshup-meta { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); flex-wrap: wrap; }
.dshup-meta .dshup-err { margin-top: 0; }
.dshup-cfg-open { outline: 1px solid var(--dsw-alias-brand-primary); border-radius: 8px; padding: 8px; }
`;
		function SvgIcon(props) {
			const size = props.size || 16;
			return react.default.createElement("svg", {
				viewBox: "0 0 24 24",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				focusable: "false"
			}, props.children);
		}
		const IconReq = () => SvgIcon({ children: react.default.createElement("polyline", { points: "22 12 18 12 15 21 9 3 6 12 2 12" }) });
		const IconIn = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), react.default.createElement("polyline", { points: "7 10 12 15 17 10" }), react.default.createElement("line", {
			x1: "12",
			y1: "15",
			x2: "12",
			y2: "3"
		})) });
		const IconCache = () => SvgIcon({ children: react.default.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }) });
		const IconOut = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("polyline", { points: "17 8 12 3 7 8" }), react.default.createElement("line", {
			x1: "12",
			y1: "3",
			x2: "12",
			y2: "15"
		}), react.default.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" })) });
		const IconCost = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("line", {
			x1: "12",
			y1: "1",
			x2: "12",
			y2: "23"
		}), react.default.createElement("path", { d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" })) });
		const IconWallet = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("rect", {
			x: "1",
			y: "4",
			width: "22",
			height: "16",
			rx: "2",
			ry: "2"
		}), react.default.createElement("line", {
			x1: "1",
			y1: "10",
			x2: "23",
			y2: "10"
		})) });
		const IconClock = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("circle", {
			cx: "12",
			cy: "12",
			r: "10"
		}), react.default.createElement("polyline", { points: "12 6 12 12 16 14" })) });
		const IconBolt = () => SvgIcon({ children: react.default.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }) });
		const IconTrend = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("polyline", { points: "23 6 13.5 15.5 8.5 10.5 1 18" }), react.default.createElement("polyline", { points: "17 6 23 6 23 12" })) });
		const IconCard = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("rect", {
			x: "2",
			y: "5",
			width: "20",
			height: "14",
			rx: "2"
		}), react.default.createElement("line", {
			x1: "2",
			y1: "10",
			x2: "22",
			y2: "10"
		})) });
		const IconGear = () => SvgIcon({ children: react.default.createElement(react.default.Fragment, null, react.default.createElement("circle", {
			cx: "12",
			cy: "12",
			r: "3"
		}), react.default.createElement("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" })) });
		function StatChip(props) {
			return react.default.createElement("div", { className: "dshup-chip" }, react.default.createElement("span", {
				className: "dshup-chip-ic",
				style: { color: props.color }
			}, props.icon), react.default.createElement("b", null, props.value), react.default.createElement("span", null, props.label));
		}
		function Sec(props) {
			return react.default.createElement("div", { className: "dshup-sec" }, props.icon ? react.default.createElement("span", { className: "dshup-sec-ic" }, props.icon) : null, react.default.createElement("span", null, props.title), props.badge ? react.default.createElement("span", { className: "dshup-badge" }, props.badge) : null);
		}
		function Meter(props) {
			const pct = props.total > 0 ? Math.round(props.value / props.total * 100) : 0;
			return react.default.createElement("div", { className: "dshup-meter" }, react.default.createElement("div", { className: "dshup-meter-top" }, react.default.createElement("span", { className: "dshup-meter-label" }, props.label), react.default.createElement("span", { className: "dshup-meter-val" }, props.fmt(props.value) + " · " + pct + "%")), react.default.createElement("div", { className: "dshup-meter-track" }, react.default.createElement("div", {
				className: "dshup-meter-fill",
				style: {
					width: Math.min(100, pct) + "%",
					background: props.color
				}
			})));
		}
		function TokenChart(props) {
			const { buckets, unit, sourceNote } = props;
			if (!buckets || buckets.length === 0) return react.default.createElement("div", { className: "dshup-hint" }, "该时间段暂无 Token 消耗数据");
			const plotBottom = 128;
			const plotH = 120;
			const max = buckets.reduce((m, b) => Math.max(m, (b.cacheHit || 0) + (b.cacheMiss || 0) + (b.output || 0)), 0) || 1;
			const step = 372 / buckets.length;
			const bw = Math.max(3, Math.min(16, step - 3));
			const bars = [];
			const labels = [];
			buckets.forEach((b, i) => {
				const x = 4 + i * step + (step - bw) / 2;
				let y = plotBottom;
				const seg = (val, color) => {
					const h = val > 0 ? Math.max(2, val / max * plotH) : 0;
					if (h > 0) {
						bars.push(react.default.createElement("rect", {
							key: "b" + i + color,
							x,
							y: y - h,
							width: bw,
							height: h,
							rx: 1,
							fill: color
						}, react.default.createElement("title", null, b.x + "  命中 " + fmtTokens(b.cacheHit) + " · 未命中 " + fmtTokens(b.cacheMiss) + " · 输出 " + fmtTokens(b.output))));
						y -= h;
					}
				};
				seg(b.cacheHit || 0, C_HIT);
				seg(b.cacheMiss || 0, C_MISS);
				seg(b.output || 0, C_OUT);
				if (i === 0 || i === buckets.length - 1 || i === Math.floor((buckets.length - 1) / 2)) labels.push(react.default.createElement("text", {
					key: "t" + i,
					x: x + bw / 2,
					y: 144,
					textAnchor: "middle",
					className: "dshup-axis"
				}, b.x));
			});
			return react.default.createElement("div", { className: "dshup-chart" }, react.default.createElement("div", { className: "dshup-chart-head" }, react.default.createElement("span", null, "Token 消耗（" + unit + "）"), react.default.createElement("span", { className: "dshup-legend" }, react.default.createElement("span", null, react.default.createElement("i", { style: { background: C_HIT } }), "命中"), react.default.createElement("span", null, react.default.createElement("i", { style: { background: C_MISS } }), "未命中"), react.default.createElement("span", null, react.default.createElement("i", { style: { background: C_OUT } }), "输出"))), react.default.createElement("svg", {
				viewBox: "0 0 380 150",
				width: "100%",
				preserveAspectRatio: "none"
			}, bars, labels), sourceNote ? react.default.createElement("div", { className: "dshup-hint" }, sourceNote) : null);
		}
		function ModelRows(props) {
			const { byModel, currency } = props;
			const list = byModel || [];
			if (list.length === 0) return react.default.createElement("div", { className: "dshup-hint" }, "该时间段暂无模型数据");
			const maxCost = list.reduce((m, x) => Math.max(m, x.cost || 0), 0) || 1;
			return react.default.createElement("div", { className: "dshup-models" }, list.map((m) => react.default.createElement("div", {
				key: m.model,
				className: "dshup-model"
			}, react.default.createElement("div", { className: "dshup-model-head" }, react.default.createElement("span", {
				className: "dshup-model-name",
				title: m.model
			}, m.model), react.default.createElement("span", { className: "dshup-accent" }, fmtMoney(m.cost, currency))), react.default.createElement("div", { className: "dshup-model-track" }, react.default.createElement("div", {
				className: "dshup-model-fill",
				style: { width: Math.max(2, Math.round(m.cost / maxCost * 100)) + "%" }
			})), react.default.createElement("div", { className: "dshup-model-meta" }, react.default.createElement("span", null, react.default.createElement(IconReq, null), fmtInt(m.requests)), react.default.createElement("span", null, react.default.createElement(IconCache, null), fmtTokens(m.cacheHit)), react.default.createElement("span", null, react.default.createElement(IconOut, null), fmtTokens(m.output))))));
		}
		function localHourSeries(local, dateKey) {
			const hours = local && local.hours || [];
			const now = /* @__PURE__ */ new Date();
			const maxH = dateKey === localDateKeyOf(now) ? now.getHours() : 23;
			const out = [];
			for (let h = 0; h <= maxH; h++) {
				const hh = pad2(h);
				const hit = hours.find((x) => x.date === dateKey && x.h === hh);
				out.push({
					x: hh + ":00",
					cacheHit: hit ? hit.cacheHit : 0,
					cacheMiss: hit ? hit.input : 0,
					output: hit ? hit.output : 0
				});
			}
			return out;
		}
		function platformDaySeries(p, range) {
			const days = p && p.days || [];
			let list = days;
			if (range === "week" && p.weekStart && p.weekEnd) list = days.filter((d) => d.full >= p.weekStart && d.full <= p.weekEnd);
			else if (range === "month" && p.monthPrefix) list = days.filter((d) => d.full.indexOf(p.monthPrefix) === 0);
			return list.map((d) => ({
				x: d.date,
				cacheHit: d.cacheHit || 0,
				cacheMiss: d.cacheMiss || 0,
				output: d.output || 0
			}));
		}
		function Detail(props) {
			const { data } = props;
			const s = useStore();
			const config = s.config;
			const position = s.position;
			const draft = s.draft;
			const [saved, setSaved] = react.default.useState(false);
			const [saveMsg, setSaveMsg] = react.default.useState("");
			const [view, setView] = react.default.useState("info");
			const [helpOpen, setHelpOpen] = react.default.useState(false);
			const [range, setRange] = react.default.useState("today");
			const p = data && data.platform;
			const l = data && data.local || {
				requests: 0,
				inputTokens: 0,
				cacheReadTokens: 0,
				outputTokens: 0,
				estimatedCostUsd: 0,
				hours: []
			};
			const b = data && data.balance;
			const pr = p && p.ranges && p.ranges[range] || p && p.totals;
			const save = () => {
				writeSaved({
					token: draft.token,
					apiKey: draft.apiKey
				});
				api.setConfig({
					token: draft.token,
					apiKey: draft.apiKey
				}).then(() => {
					setSaved(true);
					setSaveMsg("");
					refresh();
					setTimeout(() => setSaved(false), 2e3);
				}).catch((e) => {
					setSaveMsg("保存失败（与 Host 通信出错）：" + String(e && e.message || e));
				});
			};
			const forceRefresh = () => {
				api.refresh().then(() => refresh()).catch(() => refresh());
			};
			const resetLocal = () => {
				api.resetLocal().then(() => refresh()).catch(() => {});
			};
			const rows = [];
			rows.push(react.default.createElement("div", {
				key: "head",
				className: "dshup-head"
			}, react.default.createElement("span", { className: "dshup-head-title" }, "DeepSeek API 用量"), react.default.createElement("span", { className: "dshup-head-spacer" }), react.default.createElement("button", {
				className: "dshup-gear",
				title: view === "settings" ? "返回用量" : "设置",
				onClick: () => setView(view === "settings" ? "info" : "settings")
			}, react.default.createElement(IconGear, null))));
			if (view === "settings") {
				rows.push(react.default.createElement(Sec, {
					key: "sec-pos",
					title: "显示位置",
					icon: react.default.createElement(IconClock, null)
				}));
				rows.push(react.default.createElement("div", {
					key: "pos",
					className: "dshup-form"
				}, react.default.createElement("select", {
					value: position,
					onChange: (e) => setPosition(e.target.value)
				}, react.default.createElement("option", { value: "float" }, "悬浮窗（可拖动）"), react.default.createElement("option", { value: "dock" }, "输入框下方（对话栏）"))));
				rows.push(react.default.createElement("div", {
					key: "sec-c",
					className: "dshup-sec"
				}, react.default.createElement("span", { className: "dshup-sec-ic" }, react.default.createElement(IconCard, null)), react.default.createElement("span", null, "配置"), react.default.createElement("span", { className: "dshup-head-spacer" }), react.default.createElement("span", {
					className: "dshup-helpzone",
					onMouseEnter: () => setHelpOpen(true),
					onMouseLeave: () => setHelpOpen(false)
				}, react.default.createElement("button", {
					className: "dshup-help",
					title: "如何获取 userToken（点击固定/取消教程）",
					onClick: () => setHelpOpen(!helpOpen)
				}, "?"), helpOpen ? react.default.createElement("div", { className: "dshup-tutorial" }, react.default.createElement("div", { className: "dshup-tutorial-title" }, "获取 userToken 简易教程"), react.default.createElement("div", { className: "dshup-step" }, react.default.createElement("b", null, "1"), "打开 platform.deepseek.com 并登录你的账号"), react.default.createElement("div", { className: "dshup-step" }, react.default.createElement("b", null, "2"), "按 F12（或右键→检查）打开开发者工具"), react.default.createElement("div", { className: "dshup-step" }, react.default.createElement("b", null, "3"), "切到 Application → Local Storage → platform.deepseek.com"), react.default.createElement("div", { className: "dshup-step" }, react.default.createElement("b", null, "4"), "复制 userToken 字段的值"), react.default.createElement("div", { className: "dshup-step" }, react.default.createElement("b", null, "5"), "粘贴到上方输入框 → 点「保存并刷新」"), react.default.createElement("div", { className: "dshup-step" }, react.default.createElement("b", null, "6"), "（可选）API Key 仅用于余额，留空则尝试 DSH 凭据")) : null)));
				rows.push(react.default.createElement("div", {
					key: "host-state",
					className: "dshup-hint"
				}, "Host 状态：" + (config.hasToken ? "已收到平台 Token（长度 " + (config.tokenLength || 0) + "）" : "尚未收到平台 Token") + (config.hasApiKey ? "；已收到 API Key" : "") + "。"));
				rows.push(react.default.createElement("div", {
					key: "cfg",
					className: "dshup-form"
				}, react.default.createElement("label", null, react.default.createElement("span", null, "platform.deepseek.com 的 userToken" + (config.hasToken ? "（已配置）" : "（未配置）")), react.default.createElement("input", {
					type: "password",
					placeholder: "登录 platform.deepseek.com 后：F12 → Application → Local Storage → userToken",
					value: draft.token,
					onChange: (e) => setDraft({ token: e.target.value })
				})), react.default.createElement("label", null, react.default.createElement("span", null, "DeepSeek API Key（可选，仅用于余额；留空则用 DSH 凭据）"), react.default.createElement("input", {
					type: "password",
					placeholder: "sk-…",
					value: draft.apiKey,
					onChange: (e) => setDraft({ apiKey: e.target.value })
				})), react.default.createElement("div", { style: {
					display: "flex",
					gap: 8,
					alignItems: "center",
					flexWrap: "wrap"
				} }, react.default.createElement("button", {
					className: "dshup-btn",
					onClick: save
				}, saved ? "已保存 ✓" : "保存并刷新"), react.default.createElement("button", {
					className: "dshup-btn",
					onClick: forceRefresh
				}, "立即刷新"), react.default.createElement("span", { className: "dshup-hint" }, "Token 仅保存在本机浏览器与 DSH 内存中，不会写入对话。")), saveMsg ? react.default.createElement("div", { className: "dshup-err" }, saveMsg) : null));
				rows.push(react.default.createElement("div", {
					key: "done",
					className: "dshup-form dshup-form-row"
				}, react.default.createElement("button", {
					className: "dshup-btn dshup-btn-primary",
					onClick: () => setView("info")
				}, "完成")));
			} else {
				rows.push(react.default.createElement("div", {
					key: "ranges",
					className: "dshup-ranges"
				}, RANGES.map((r) => react.default.createElement("button", {
					key: r.k,
					className: "dshup-range" + (range === r.k ? " dshup-range-on" : ""),
					onClick: () => setRange(r.k)
				}, r.label))));
				const dayRange = range === "today" || range === "yesterday";
				if (p && pr) {
					rows.push(react.default.createElement("div", {
						key: "hero",
						className: "dshup-hero"
					}, react.default.createElement("div", null, react.default.createElement("div", { className: "dshup-hero-label" }, RANGES.find((r) => r.k === range).label + "消费（" + p.currency + "）"), react.default.createElement("div", { className: "dshup-hero-num" }, fmtMoney(pr.cost, p.currency)), react.default.createElement("span", { className: "dshup-hint" }, (range === "month" ? p.month : p.month + " · " + (range === "week" ? "周一起" : "")) + " · 更新于 " + fmtTime(data.lastUpdated))), react.default.createElement("div", { className: "dshup-chips" }, react.default.createElement(StatChip, {
						icon: react.default.createElement(IconReq, null),
						color: C_MISS,
						value: fmtInt(pr.requests),
						label: "请求次数"
					}), react.default.createElement(StatChip, {
						icon: react.default.createElement(IconTrend, null),
						color: C_HIT,
						value: pr.cacheHitRate + "%",
						label: "缓存命中率"
					}), react.default.createElement(StatChip, {
						icon: react.default.createElement(IconOut, null),
						color: C_OUT,
						value: fmtTokens(pr.output),
						label: "输出 Tokens"
					}))));
					const totalTokens = pr.input + pr.output;
					if (totalTokens > 0) {
						rows.push(react.default.createElement(Sec, {
							key: "sec-mix",
							title: "用量构成",
							icon: react.default.createElement(IconBolt, null)
						}));
						rows.push(react.default.createElement("div", {
							key: "meters",
							className: "dshup-meters"
						}, react.default.createElement(Meter, {
							label: "输入 · 缓存命中",
							value: pr.cacheHit,
							total: totalTokens,
							fmt: fmtTokens,
							color: C_HIT
						}), react.default.createElement(Meter, {
							label: "输入 · 缓存未命中",
							value: pr.cacheMiss,
							total: totalTokens,
							fmt: fmtTokens,
							color: C_MISS
						}), react.default.createElement(Meter, {
							label: "输出",
							value: pr.output,
							total: totalTokens,
							fmt: fmtTokens,
							color: C_OUT
						})));
					}
					let buckets = null;
					let unit = "按小时";
					let sourceNote = null;
					if (dayRange) {
						const todayKey = localDateKeyOf(/* @__PURE__ */ new Date());
						const yKey = localDateKeyOf(/* @__PURE__ */ new Date(Date.now() - 864e5));
						buckets = localHourSeries(l, range === "today" ? todayKey : yKey);
						unit = "按小时";
						sourceNote = "小时粒度来自 DSH 本机会话；平台仅提供日粒度";
					} else {
						buckets = platformDaySeries(p, range);
						unit = "按天";
					}
					if (buckets && buckets.length > 0) rows.push(react.default.createElement(TokenChart, {
						key: "chart",
						buckets,
						unit,
						sourceNote
					}));
					rows.push(react.default.createElement(Sec, {
						key: "sec-m",
						title: "按模型",
						icon: react.default.createElement(IconCard, null)
					}));
					rows.push(react.default.createElement(ModelRows, {
						key: "models",
						byModel: pr.byModel,
						currency: p.currency
					}));
				} else {
					const err = data && data.error;
					rows.push(react.default.createElement("div", {
						key: "cta",
						className: "dshup-cta"
					}, react.default.createElement("span", { className: "dshup-cta-ic" }, react.default.createElement(IconBolt, { size: 18 })), react.default.createElement("div", { className: "dshup-cta-body" }, react.default.createElement("b", null, "尚未配置平台 Token"), react.default.createElement("span", null, err && err.indexOf("未配置平台 Token") !== 0 ? err : "配置后即可查看平台用量、消费金额与余额；配置框内的 ? 有获取教程。")), react.default.createElement("button", {
						className: "dshup-btn dshup-btn-primary",
						onClick: () => setView("settings")
					}, "去配置")));
					if (dayRange) {
						const todayKey = localDateKeyOf(/* @__PURE__ */ new Date());
						const yKey = localDateKeyOf(/* @__PURE__ */ new Date(Date.now() - 864e5));
						const buckets = localHourSeries(l, range === "today" ? todayKey : yKey);
						if (buckets && buckets.length > 0 && buckets.some((x) => x.cacheHit + x.cacheMiss + x.output > 0)) rows.push(react.default.createElement(TokenChart, {
							key: "chart-local",
							buckets,
							unit: "按小时",
							sourceNote: "DSH 本机会话 Token 消耗（未连接平台）"
						}));
					}
				}
				if (b && b.infos.length > 0) {
					rows.push(react.default.createElement(Sec, {
						key: "sec-b",
						title: "账户余额",
						icon: react.default.createElement(IconWallet, null),
						badge: b.source === "credentials" ? "DSH 凭据" : b.source === "user" ? "手动配置" : "平台 Token"
					}));
					rows.push(react.default.createElement("div", {
						key: "g-b",
						className: "dshup-chips"
					}, b.infos.map((i) => react.default.createElement(StatChip, {
						key: i.currency,
						icon: react.default.createElement(IconCard, null),
						color: C_HIT,
						value: fmtMoney(i.total, i.currency),
						label: i.currency + " 余额"
					}))));
					rows.push(react.default.createElement("div", {
						key: "b-detail",
						className: "dshup-hint"
					}, b.infos.map((i) => "赠送 " + fmtMoney(i.granted, i.currency) + " · 充值 " + fmtMoney(i.toppedUp, i.currency)).join("   |   ")));
				}
				rows.push(react.default.createElement(Sec, {
					key: "sec-l",
					title: "DSH 实时（本会话）",
					icon: react.default.createElement(IconTrend, null)
				}));
				rows.push(react.default.createElement("div", {
					key: "g-l",
					className: "dshup-chips"
				}, react.default.createElement(StatChip, {
					icon: react.default.createElement(IconReq, null),
					color: C_MISS,
					value: fmtInt(l.requests),
					label: "请求"
				}), react.default.createElement(StatChip, {
					icon: react.default.createElement(IconIn, null),
					color: C_MISS,
					value: fmtTokens(l.inputTokens),
					label: "输入·未命中"
				}), react.default.createElement(StatChip, {
					icon: react.default.createElement(IconCache, null),
					color: C_HIT,
					value: fmtTokens(l.cacheReadTokens),
					label: "输入·命中"
				}), react.default.createElement(StatChip, {
					icon: react.default.createElement(IconOut, null),
					color: C_OUT,
					value: fmtTokens(l.outputTokens),
					label: "输出"
				}), react.default.createElement(StatChip, {
					icon: react.default.createElement(IconCost, null),
					color: C_WARN,
					value: "$" + (l.estimatedCostUsd || 0).toFixed(4),
					label: "估算 USD"
				})));
				rows.push(react.default.createElement("div", {
					key: "reset",
					className: "dshup-form dshup-form-row"
				}, react.default.createElement("button", {
					className: "dshup-btn",
					onClick: resetLocal
				}, "清零本会话计数")));
				rows.push(react.default.createElement("div", {
					key: "meta",
					className: "dshup-meta"
				}, react.default.createElement(IconClock, null), react.default.createElement("span", null, "更新于 " + fmtTime(data && data.lastUpdated)), data && data.error ? react.default.createElement("span", { className: "dshup-err" }, data.error) : null));
			}
			return react.default.createElement("div", { className: "dshup-panel" }, rows);
		}
		function useStore() {
			const [, force] = react.default.useState(0);
			react.default.useEffect(() => subscribe(() => force((n) => n + 1)), []);
			return getState();
		}
		function WhaleIcon(props) {
			const size = props && props.size ? props.size : 20;
			return react.default.createElement("svg", {
				viewBox: "0 0 50 50",
				width: size,
				height: size,
				"aria-hidden": true,
				focusable: "false"
			}, react.default.createElement("path", {
				d: "M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z",
				fill: "#4D6BFE",
				fillRule: "nonzero"
			}));
		}
		function StatusDot(props) {
			return react.default.createElement("span", {
				className: "dshup-dot " + (props.error ? "dshup-dot-warn" : "dshup-dot-ok"),
				title: props.error || ""
			});
		}
		function CompactBody(props) {
			const { data, status } = props;
			const p = data && data.platform;
			const l = data && data.local;
			if (p) {
				const t = p.totals;
				return react.default.createElement(react.default.Fragment, null, react.default.createElement("span", null, "请求 ", react.default.createElement("b", { className: "dshup-num" }, fmtInt(t.requests))), react.default.createElement("span", null, "费用 ", react.default.createElement("b", { className: "dshup-accent" }, fmtMoney(t.cost, p.currency))), react.default.createElement("span", { className: "dshup-hint" }, "（" + p.month + "）"));
			}
			if (l && l.requests > 0) return react.default.createElement(react.default.Fragment, null, react.default.createElement("span", null, "DSH 实时 ", react.default.createElement("b", { className: "dshup-num" }, fmtInt(l.requests)), " 次"), react.default.createElement("span", null, "估算 ", react.default.createElement("b", { className: "dshup-accent" }, "$" + (l.estimatedCostUsd || 0).toFixed(4))));
			if (status === "ok") {
				const err = data && data.error;
				if (err && err.indexOf("未配置平台 Token") !== 0) return react.default.createElement("span", {
					className: "dshup-err",
					title: err
				}, "平台数据获取失败：" + (err.length > 42 ? err.slice(0, 42) + "…" : err));
				return react.default.createElement("span", { className: "dshup-hint" }, "未配置平台 Token，点击展开配置");
			}
			return react.default.createElement("span", { className: "dshup-hint" }, "加载中…");
		}
		function UsageDock() {
			const s = useStore();
			const [expanded, setExpanded] = react.default.useState(false);
			if (s.position !== "dock") return null;
			const children = [react.default.createElement("div", {
				key: "line",
				className: "dshup-row",
				onClick: () => setExpanded(!expanded)
			}, react.default.createElement(StatusDot, { error: s.data && s.data.error }), react.default.createElement("span", { className: "dshup-title" }, "API 用量"), react.default.createElement(CompactBody, {
				data: s.data,
				status: s.status
			}), react.default.createElement("span", { className: "dshup-caret" }, expanded ? "▾" : "▸"))];
			if (expanded) children.push(react.default.createElement(Detail, {
				key: "detail",
				data: s.data
			}));
			return react.default.createElement("div", null, children);
		}
		function UsageFloat() {
			const s = useStore();
			const [expanded, setExpanded] = react.default.useState(false);
			const dragRef = react.default.useRef({
				sx: 0,
				sy: 0,
				ox: 0,
				oy: 0,
				moved: false
			});
			const draggingRef = react.default.useRef(false);
			const hoverRef = react.default.useRef(false);
			const hoverTimer = react.default.useRef(null);
			const closeTimer = react.default.useRef(null);
			if (s.position !== "float") return null;
			const pos = s.floatPos || defaultFloatPos();
			const vwF = () => window.innerWidth || 1280;
			const vhF = () => window.innerHeight || 800;
			const openUp = pos.y > vhF() / 2;
			const openLeft = pos.x > vwF() / 2;
			const gap = 8;
			const pillW = 48;
			const pillH = 48;
			const availUp = pos.y - gap - 12;
			const availDown = vhF() - pos.y - pillH - gap - 12;
			const cardMaxH = Math.max(140, Math.min(680, openUp ? availUp : availDown));
			const cardMaxW = Math.max(200, Math.min(480, (openLeft ? pos.x + pillW : vwF() - pos.x) - gap - 12));
			const scheduleExpand = () => {
				if (hoverTimer.current !== null || draggingRef.current) return;
				hoverTimer.current = window.setTimeout(() => {
					hoverTimer.current = null;
					setExpanded(true);
				}, 350);
			};
			const cancelExpand = () => {
				if (hoverTimer.current !== null) {
					window.clearTimeout(hoverTimer.current);
					hoverTimer.current = null;
				}
			};
			const armClose = () => {
				if (closeTimer.current !== null) return;
				closeTimer.current = window.setTimeout(() => {
					closeTimer.current = null;
					if (!hoverRef.current && !draggingRef.current) setExpanded(false);
				}, 250);
			};
			const cancelClose = () => {
				if (closeTimer.current !== null) {
					window.clearTimeout(closeTimer.current);
					closeTimer.current = null;
				}
			};
			const onEnter = () => {
				hoverRef.current = true;
				cancelClose();
				scheduleExpand();
			};
			const onLeave = () => {
				hoverRef.current = false;
				cancelExpand();
				armClose();
			};
			const onPillMouseDown = (e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				cancelExpand();
				const base = s.floatPos || defaultFloatPos();
				const d = dragRef.current;
				d.sx = e.clientX;
				d.sy = e.clientY;
				d.ox = base.x;
				d.oy = base.y;
				d.moved = false;
				draggingRef.current = true;
				setState({ dragging: true });
				const vw = () => window.innerWidth || 2e3;
				const vh = () => window.innerHeight || 1500;
				const onMove = (ev) => {
					const dx = ev.clientX - d.sx;
					const dy = ev.clientY - d.sy;
					if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true;
					setState({ floatPos: {
						x: Math.max(4, Math.min(vw() - 40, d.ox + dx)),
						y: Math.max(4, Math.min(vh() - 30, d.oy + dy))
					} });
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
					draggingRef.current = false;
					setState({ dragging: false });
					if (dragRef.current.moved && state.floatPos) writeSaved({
						floatX: state.floatPos.x,
						floatY: state.floatPos.y
					});
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};
			const children = [];
			if (expanded) children.push(react.default.createElement("div", {
				key: "card",
				className: "dshup-card",
				style: {
					width: cardMaxW + "px",
					maxHeight: cardMaxH + "px"
				},
				onMouseEnter: onEnter,
				onMouseLeave: onLeave
			}, react.default.createElement(Detail, { data: s.data })));
			children.push(react.default.createElement("div", {
				key: "btn",
				className: "dshup-whale-btn",
				draggable: false,
				onMouseDown: onPillMouseDown,
				onClick: () => {
					if (!dragRef.current.moved) setExpanded(!expanded);
				},
				title: "DeepSeek API 用量（点击展开，按住拖动）"
			}, react.default.createElement("span", { className: "dshup-whale" }, react.default.createElement(WhaleIcon, { size: 40 }), react.default.createElement(StatusDot, { error: s.data && s.data.error }))));
			return react.default.createElement("div", {
				className: "dshup-float" + (s.dragging ? " dshup-dragging" : "") + (openUp ? " dshup-oc-up" : " dshup-oc-down") + (openLeft ? " dshup-oc-left" : " dshup-oc-right"),
				style: {
					left: pos.x + "px",
					top: pos.y + "px"
				},
				onMouseEnter: onEnter,
				onMouseLeave: onLeave
			}, children);
		}
		const inject = [
			"slots",
			"timer",
			"connection"
		];
		function apply(ctx) {
			api = createUsageApi(ctx);
			injectStyles(CSS);
			const saved = readSaved();
			let position = saved.position;
			if (position !== "float" && position !== "dock") {
				position = "float";
				writeSaved({ position });
			}
			setState({
				position,
				floatPos: savedFloatPos(),
				draft: {
					token: saved.token || "",
					apiKey: saved.apiKey || ""
				}
			});
			if (saved.token || saved.apiKey) api.setConfig({
				token: saved.token || "",
				apiKey: saved.apiKey || ""
			}).catch(() => {});
			refresh();
			refreshConfig();
			ctx.interval(refresh, 2e3);
			ctx.interval(refreshConfig, 3e4);
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "usage",
				order: 50,
				label: "API 用量"
			}, UsageDock));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "usage-float",
				order: 50,
				label: "API 用量浮窗"
			}, UsageFloat));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map