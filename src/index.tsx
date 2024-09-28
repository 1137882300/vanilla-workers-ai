import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { renderer } from "./renderer";
import { EventSourceParserStream } from "eventsource-parser/stream";

type Bindings = {
  AI: any;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(renderer);

app.get("/", (c) => {
  return c.render(
    <>
      <div className="flex h-screen bg-gray-100">
        {/* 左侧聊天窗口 */}
        <div className="flex-grow flex flex-col chat-container"> {/* 添加 chat-container 类 */}
          <header className="bg-blue-600 text-white p-4 flex justify-between items-center">
            <h1 className="text-2xl font-bold">AI Chat Assistant</h1>
            <button
              id="toggle-settings"
              className="md:hidden bg-blue-500 text-white p-2 rounded-full"
            >
              ⚙️
            </button>
          </header>
          <div
            id="chat-history"
            className="flex-grow bg-gray-100 rounded-lg p-4 mb-4 overflow-y-auto flex flex-col"
          ></div>
          <form id="chat-form" className="flex items-center bg-white rounded-full shadow-lg p-2">
            <textarea
              id="message-input"
              className="flex-grow p-2 bg-transparent focus:outline-none resize-none"
              placeholder="Type your message here..."
              rows={1}
            ></textarea>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-full transition duration-300 ease-in-out"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <p className="model-display text-sm text-gray-500 mt-2">-</p>
        </div>

        {/* 右侧设置面板 */}
        <div id="settings-panel" className="w-80 bg-white shadow-lg p-6 overflow-y-auto md:block">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Chat Settings</h2>
            <button id="close-settings" className="md:hidden text-gray-500 hover:text-gray-700">
              ✕
            </button>
          </div>
          <form>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="model-select">
                Model
              </label>
              <select
                id="model-select"
                className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              ></select>
            </div>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="system-message">
                System Message
              </label>
              <textarea
                id="system-message"
                className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter system message..."
                rows={4}
              ></textarea>
            </div>
            <button
              id="apply-chat-settings"
              className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-md transition duration-300 ease-in-out"
            >
              Apply Changes
            </button>
          </form>
        </div>
      </div>
      <script src="/static/script.js"></script>
    </>
  );
});

app.post("/api/chat", async (c) => {
  const payload = await c.req.json();
  const messages = [...payload.messages];
  // Prepend the systemMessage
  if (payload?.config?.systemMessage) {
    messages.unshift({ role: "system", content: payload.config.systemMessage });
  }
  //console.log("Model", payload.config.model);
  //console.log("Messages", JSON.stringify(messages));
  let eventSourceStream;
  let retryCount = 0;
  let successfulInference = false;
  let lastError;
  const MAX_RETRIES = 3;
  while (successfulInference === false && retryCount < MAX_RETRIES) {
    try {
      eventSourceStream = (await c.env.AI.run(payload.config.model, {
        messages,
        stream: true,
      })) as ReadableStream;
      successfulInference = true;
    } catch (err) {
      lastError = err;
      retryCount++;
      console.error(err);
      console.log(`Retrying #${retryCount}...`);
    }
  }
  if (eventSourceStream === undefined) {
    if (lastError) {
      throw lastError;
    }
    throw new Error(`Problem with model`);
  }
  // EventSource stream is handy for local event sources, but we want to just stream text
  const tokenStream = eventSourceStream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  return streamText(c, async (stream) => {
    for await (const msg of tokenStream) {
      if (msg.data !== "[DONE]") {
        const data = JSON.parse(msg.data);
        stream.write(data.response);
      }
    }
  });
});

export default app;
