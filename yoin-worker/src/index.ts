import { DurableObject } from "cloudflare:workers";

// ============================================================
// Protocol Constants (與前端 YoinClient.ts 保持一致)
// ============================================================
const MSG_SYNC_STEP_1 = 0;
const MSG_SYNC_STEP_2 = 1;
const MSG_SYNC_STEP_1_REPLY = 2;
const MSG_AWARENESS = 3;
const MSG_JOIN_ROOM = 4; // DO 路由已處理房間，此訊息僅消費不轉發

// ============================================================
// YoinRoom — Durable Object (WebSocket Hibernation API)
// ============================================================
export class YoinRoom extends DurableObject<Env> {

	/**
	 * 處理 WebSocket 升級請求
	 */
	async fetch(request: Request): Promise<Response> {
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader !== "websocket") {
			return new Response("Expected WebSocket upgrade", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// 使用 Hibernation API — DO 在無訊息時可休眠，降低成本
		this.ctx.acceptWebSocket(server);

		return new Response(null, { status: 101, webSocket: client });
	}

	/**
	 * 收到 WebSocket 二進制/文字訊息時觸發
	 * 邏輯：將訊息廣播給房間內所有其他連線者
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		if (message instanceof ArrayBuffer) {
			const data = new Uint8Array(message);
			const type = data[0];

			// MSG_JOIN_ROOM 在 DO 架構下由 URL 路由處理，不轉發
			if (type === MSG_JOIN_ROOM) return;

			// 廣播給同房間的其他用戶
			const sockets = this.ctx.getWebSockets();
			for (const socket of sockets) {
				if (socket !== ws) {
					try {
						socket.send(message);
					} catch {
						// 連線已斷，靜默忽略
					}
				}
			}
		}
	}

	/**
	 * WebSocket 連線關閉
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		ws.close(code, reason);
	}

	/**
	 * WebSocket 連線錯誤
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		ws.close(1011, "Unexpected error");
	}
}

// ============================================================
// Worker Entry — 路由請求到對應的 YoinRoom DO
// ============================================================
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// 支援兩種路由格式：
		// 1. 路徑式: /room/{roomId}
		// 2. 查詢式: ?room={roomId} (相容現有前端)
		let roomId: string | null = null;
		const pathMatch = url.pathname.match(/^\/room\/(.+)$/);
		if (pathMatch) {
			roomId = decodeURIComponent(pathMatch[1]);
		} else {
			roomId = url.searchParams.get("room");
		}

		if (!roomId) {
			return new Response(
				JSON.stringify({ error: "Missing room ID. Use /room/{id} or ?room={id}" }),
				{ status: 400, headers: { "Content-Type": "application/json" } }
			);
		}

		// 根據 roomId 取得對應的 Durable Object 實例
		const id = env.YOIN_ROOM.idFromName(roomId);
		const stub = env.YOIN_ROOM.get(id);

		return stub.fetch(request);
	},
} satisfies ExportedHandler<Env>;
