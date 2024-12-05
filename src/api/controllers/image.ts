import { PassThrough } from "stream";
import path from "path";
import _ from "lodash";
import mime from "mime";
import FormData from "form-data";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { createParser } from "eventsource-parser";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";

// 模型名称
const MODEL_NAME = "jimeng";
// 默认的AgentID
const DEFAULT_ASSISTANT_ID = "513695";
// 版本号
const VERSION_CODE = "5.8.0";
// 平台代码
const PLATFORM_CODE = "7";
// 设备ID
const DEVICE_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// WebID
const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// 用户ID
const USER_ID = util.uuid(false);
// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;
// 伪装headers
const FAKE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-language": "zh-CN,zh;q=0.9",
  "Cache-control": "no-cache",
  "Last-event-id": "undefined",
  Appid: DEFAULT_ASSISTANT_ID,
  Appvr: VERSION_CODE,
  Origin: "https://jimeng.jianying.com",
  Pragma: "no-cache",
  Priority: "u=1, i",
  Referer: "https://jimeng.jianying.com",
  Pf: PLATFORM_CODE,
  "Sec-Ch-Ua":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
// 文件最大大小
const FILE_MAX_SIZE = 100 * 1024 * 1024;

/**
 * 获取缓存中的access_token
 *
 * 目前jimeng的access_token是固定的，暂无刷新功能
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
async function acquireToken(refreshToken: string): Promise<string> {
  return refreshToken;
}

/**
 * 生成伪msToken
 */
function generateFakeMsToken() {
  const bytes = new Uint8Array(96); // 96 bytes = 128 base64 chars
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-") // Convert + to -
    .replace(/\//g, "_") // Convert / to _
    .replace(/=/g, ""); // Remove padding
}

/**
 * 生成伪a_bogus
 */
function generateFakeABogus() {
  return `mf-${util.generateRandomString({
    length: 34,
  })}-${util.generateRandomString({
    length: 6,
  })}`;
}

/**
 * 生成cookie
 */
function generateCookie(refreshToken: string, msToken: string) {
  return [
    `is_staff_user=false`,
    `store-region=cn-gd`,
    `store-region-src=uid`,
    `sid_guard=${refreshToken}%7C${util.unixTimestamp()}%7C5184000%7CSun%2C+02-Feb-2025+04%3A17%3A20+GMT`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${refreshToken}`,
    `sessionid=${refreshToken}`,
    `sessionid_ss=${refreshToken}`,
    `msToken=${msToken}`,
  ].join("; ");
}

/**
 * 请求jimeng
 *
 * @param method 请求方法
 * @param uri 请求路径
 * @param params 请求参数
 * @param headers 请求头
 */
async function request(
  method: string,
  uri: string,
  refreshToken: string,
  options: AxiosRequestConfig = {}
) {
  const token = await acquireToken(refreshToken);
  const msToken = generateFakeMsToken();
  const deviceTime = util.unixTimestamp();
  const sign = util.md5(
    `9e2c|_config|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}|11ac`
  );
  const response = await axios.request({
    method,
    url: `https://jimeng.jianying.com${uri}`,
    params: {
      aid: DEFAULT_ASSISTANT_ID,
      device_platform: "web",
      region: "CN",
      web_id: WEB_ID,
      ...(options.params || {}),
    },
    headers: {
      ...FAKE_HEADERS,
      Cookie: generateCookie(token, msToken),
      "Device-Time": deviceTime,
      Sign: sign,
      "Sign-Ver": "1",
      ...(options.headers || {}),
    },
    timeout: 15000,
    validateStatus: () => true,
    ..._.omit(options, "params", "headers"),
  });
  // 流式响应直接返回response
  if (options.responseType == "stream") return response;
  return checkResult(response);
}

export async function generateImage(prompt: string, refreshToken: string) {
  return request("post", "/mweb/v1/aigc_draft/generate", refreshToken, {
    params: {
      babi_param: encodeURIComponent(
        JSON.stringify({
          scenario: "image_video_generation",
          feature_key: "aigc_to_image",
          feature_entrance: "to_image",
          feature_entrance_detail:
            "to_image-high_aes_general_v21_L:general_v2.1_L",
        })
      ),
    },
    data: {
      extend: {
        root_model: "high_aes_general_v21_L:general_v2.1_L",
        template_id: "",
      },
      submit_id: util.uuid(),
      metrics_extra: JSON.stringify({
        templateId: "",
        generateCount: 1,
        promptSource: "custom",
        templateSource: "",
        lastRequestId: "",
        originRequestId: "",
      }),
      draft_content: JSON.stringify({
        type: "draft",
        id: "dbdb11b4-4bca-a2f2-ecf8-7cb1beae2413",
        min_version: "3.0.2",
        is_from_tsn: true,
        version: "3.0.2",
        main_component_id: "dbf168dc-da45-a922-f657-3f777f6ebfc1",
        component_list: [
          {
            type: "image_base_component",
            id: "dbf168dc-da45-a922-f657-3f777f6ebfc1",
            min_version: "3.0.2",
            generate_type: "generate",
            aigc_mode: "workbench",
            abilities: {
              type: "",
              id: util.uuid(),
              generate: {
                type: "",
                id: util.uuid(),
                core_param: {
                  type: "",
                  id: util.uuid(),
                  model: "high_aes_general_v21_L:general_v2.1_L",
                  prompt,
                  negative_prompt: "",
                  seed: 2569958340,
                  sample_strength: 0.5,
                  image_ratio: 1,
                  large_image_info: {
                    type: "",
                    id: util.uuid(),
                    height: 1024,
                    width: 1024,
                  },
                },
                history_option: {
                  type: "",
                  id: util.uuid(),
                },
              },
            },
          },
        ],
      }),
      http_common_info: {
        aid: 513695,
      },
    },
  });
}

/**
 * 移除会话
 *
 * 在对话流传输完毕后移除会话，避免创建的会话出现在用户的对话列表中
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
async function removeConversation(convId: string, refreshToken: string) {
  await request("post", "/samantha/thread/delete", refreshToken, {
    data: {
      conversation_id: convId,
    },
  });
}

/**
 * 同步对话补全
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param assistantId 智能体ID，默认使用jimeng原版
 * @param retryCount 重试次数
 */
async function createCompletion(
  messages: any[],
  refreshToken: string,
  assistantId = DEFAULT_ASSISTANT_ID,
  refConvId = "",
  retryCount = 0
) {
  return (async () => {
    logger.info(messages);

    // 提取引用文件URL并上传获得引用的文件ID列表
    const refFileUrls = extractRefFileUrls(messages);
    const refs = refFileUrls.length
      ? await Promise.all(
          refFileUrls.map((fileUrl) => uploadFile(fileUrl, refreshToken))
        )
      : [];

    // 如果引用对话ID不正确则重置引用
    if (!/[0-9a-zA-Z]{24}/.test(refConvId)) refConvId = "";

    // 请求流
    const response = await request(
      "post",
      "/samantha/chat/completion",
      refreshToken,
      {
        data: {
          messages: messagesPrepare(messages, refs, !!refConvId),
          completion_option: {
            is_regen: false,
            with_suggest: true,
            need_create_conversation: true,
            launch_stage: 1,
            is_replace: false,
            is_delete: false,
            message_from: 0,
            event_id: "0",
          },
          conversation_id: "0",
          local_conversation_id: `local_16${util.generateRandomString({
            length: 14,
            charset: "numeric",
          })}`,
          local_message_id: util.uuid(),
        },
        headers: {
          Referer: "https://www.jimeng.com/chat/",
          "Agw-js-conv": "str",
        },
        // 300秒超时
        timeout: 300000,
        responseType: "stream",
      }
    );
    if (response.headers["content-type"].indexOf("text/event-stream") == -1) {
      response.data.on("data", (buffer) => logger.error(buffer.toString()));
      throw new APIException(
        EX.API_REQUEST_FAILED,
        `Stream response Content-Type invalid: ${response.headers["content-type"]}`
      );
    }

    const streamStartTime = util.timestamp();
    // 接收流为输出文本
    const answer = await receiveStream(response.data);
    logger.success(
      `Stream has completed transfer ${util.timestamp() - streamStartTime}ms`
    );

    // 异步移除会话
    removeConversation(answer.id, refreshToken).catch(
      (err) => !refConvId && console.error("移除会话失败：", err)
    );

    return answer;
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Stream response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletion(
          messages,
          refreshToken,
          assistantId,
          refConvId,
          retryCount + 1
        );
      })();
    }
    throw err;
  });
}

/**
 * 流式对话补全
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param assistantId 智能体ID，默认使用jimeng原版
 * @param retryCount 重试次数
 */
async function createCompletionStream(
  messages: any[],
  refreshToken: string,
  assistantId = DEFAULT_ASSISTANT_ID,
  refConvId = "",
  retryCount = 0
) {
  return (async () => {
    logger.info(messages);

    // 提取引用文件URL并上传获得引用的文件ID列表
    const refFileUrls = extractRefFileUrls(messages);
    const refs = refFileUrls.length
      ? await Promise.all(
          refFileUrls.map((fileUrl) => uploadFile(fileUrl, refreshToken))
        )
      : [];

    // 如果引用对话ID不正确则重置引用
    if (!/[0-9a-zA-Z]{24}/.test(refConvId)) refConvId = "";

    // 请求流
    const response = await request(
      "post",
      "/samantha/chat/completion",
      refreshToken,
      {
        data: {
          messages: messagesPrepare(messages, refs, !!refConvId),
          completion_option: {
            is_regen: false,
            with_suggest: true,
            need_create_conversation: true,
            launch_stage: 1,
            is_replace: false,
            is_delete: false,
            message_from: 0,
            event_id: "0",
          },
          conversation_id: "0",
          local_conversation_id: `local_16${util.generateRandomString({
            length: 14,
            charset: "numeric",
          })}`,
          local_message_id: util.uuid(),
        },
        headers: {
          Referer: "https://www.jimeng.com/chat/",
          "Agw-js-conv": "str",
        },
        // 300秒超时
        timeout: 300000,
        responseType: "stream",
      }
    );

    if (response.headers["content-type"].indexOf("text/event-stream") == -1) {
      logger.error(
        `Invalid response Content-Type:`,
        response.headers["content-type"]
      );
      response.data.on("data", (buffer) => logger.error(buffer.toString()));
      const transStream = new PassThrough();
      transStream.end(
        `data: ${JSON.stringify({
          id: "",
          model: MODEL_NAME,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "服务暂时不可用，第三方响应错误",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          created: util.unixTimestamp(),
        })}\n\n`
      );
      return transStream;
    }

    const streamStartTime = util.timestamp();
    // 创建转换流将消息格式转换为gpt兼容格式
    return createTransStream(response.data, (convId: string) => {
      logger.success(
        `Stream has completed transfer ${util.timestamp() - streamStartTime}ms`
      );
      // 流传输结束后异步移除会话
      removeConversation(convId, refreshToken).catch(
        (err) => !refConvId && console.error(err)
      );
    });
  })().catch((err) => {
    if (retryCount < MAX_RETRY_COUNT) {
      logger.error(`Stream response error: ${err.stack}`);
      logger.warn(`Try again after ${RETRY_DELAY / 1000}s...`);
      return (async () => {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
        return createCompletionStream(
          messages,
          refreshToken,
          assistantId,
          refConvId,
          retryCount + 1
        );
      })();
    }
    throw err;
  });
}

/**
 * 提取消息中引用的文件URL
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 */
function extractRefFileUrls(messages: any[]) {
  const urls = [];
  // 如果没有消息，则返回[]
  if (!messages.length) {
    return urls;
  }
  // 只获取最新的消息
  const lastMessage = messages[messages.length - 1];
  if (_.isArray(lastMessage.content)) {
    lastMessage.content.forEach((v) => {
      if (!_.isObject(v) || !["file", "image_url"].includes(v["type"])) return;
      // jimeng-free-api支持格式
      if (
        v["type"] == "file" &&
        _.isObject(v["file_url"]) &&
        _.isString(v["file_url"]["url"])
      )
        urls.push(v["file_url"]["url"]);
      // 兼容gpt-4-vision-preview API格式
      else if (
        v["type"] == "image_url" &&
        _.isObject(v["image_url"]) &&
        _.isString(v["image_url"]["url"])
      )
        urls.push(v["image_url"]["url"]);
    });
  }
  logger.info("本次请求上传：" + urls.length + "个文件");
  return urls;
}

/**
 * 消息预处理
 *
 * 由于接口只取第一条消息，此处会将多条消息合并为一条，实现多轮对话效果
 *
 * @param messages 参考gpt系列消息格式，多轮对话请完整提供上下文
 * @param refs 参考文件列表
 * @param isRefConv 是否为引用会话
 */
function messagesPrepare(messages: any[], refs: any[], isRefConv = false) {
  let content;
  if (isRefConv || messages.length < 2) {
    content = messages.reduce((content, message) => {
      if (_.isArray(message.content)) {
        return message.content.reduce((_content, v) => {
          if (!_.isObject(v) || v["type"] != "text") return _content;
          return _content + (v["text"] || "") + "\n";
        }, content);
      }
      return content + `${message.content}\n`;
    }, "");
    logger.info("\n透传内容：\n" + content);
  } else {
    // 检查最新消息是否含有"type": "image_url"或"type": "file",如果有则注入消息
    let latestMessage = messages[messages.length - 1];
    let hasFileOrImage =
      Array.isArray(latestMessage.content) &&
      latestMessage.content.some(
        (v) =>
          typeof v === "object" && ["file", "image_url"].includes(v["type"])
      );
    if (hasFileOrImage) {
      let newFileMessage = {
        content: "关注用户最新发送文件和消息",
        role: "system",
      };
      messages.splice(messages.length - 1, 0, newFileMessage);
      logger.info("注入提升尾部文件注意力system prompt");
    } else {
      // 由于注入会导致设定污染，暂时注释
      // let newTextMessage = {
      //   content: "关注用户最新的消息",
      //   role: "system",
      // };
      // messages.splice(messages.length - 1, 0, newTextMessage);
      // logger.info("注入提升尾部消息注意力system prompt");
    }
    content = messages
      .reduce((content, message) => {
        const role = message.role
          .replace("system", "<|im_start|>system")
          .replace("assistant", "<|im_start|>assistant")
          .replace("user", "<|im_start|>user");
        if (_.isArray(message.content)) {
          return message.content.reduce((_content, v) => {
            if (!_.isObject(v) || v["type"] != "text") return _content;
            return _content + (`${role}\n` + v["text"] || "") + "\n";
          }, content);
        }
        return (content += `${role}\n${message.content}\n`) + "<|im_end|>\n";
      }, "")
      // 移除MD图像URL避免幻觉
      .replace(/\!\[.+\]\(.+\)/g, "")
      // 移除临时路径避免在新会话引发幻觉
      .replace(/\/mnt\/data\/.+/g, "");
    logger.info("\n对话合并：\n" + content);
  }

  const fileRefs = refs.filter((ref) => !ref.width && !ref.height);
  const imageRefs = refs
    .filter((ref) => ref.width || ref.height)
    .map((ref) => {
      ref.image_url = ref.file_url;
      return ref;
    });
  return [
    {
      content: JSON.stringify({ text: content }),
      content_type: 2001,
      attachments: [],
      references: [],
    },
  ];
}

/**
 * 预检查文件URL有效性
 *
 * @param fileUrl 文件URL
 */
async function checkFileUrl(fileUrl: string) {
  if (util.isBASE64Data(fileUrl)) return;
  const result = await axios.head(fileUrl, {
    timeout: 15000,
    validateStatus: () => true,
  });
  if (result.status >= 400)
    throw new APIException(
      EX.API_FILE_URL_INVALID,
      `File ${fileUrl} is not valid: [${result.status}] ${result.statusText}`
    );
  // 检查文件大小
  if (result.headers && result.headers["content-length"]) {
    const fileSize = parseInt(result.headers["content-length"], 10);
    if (fileSize > FILE_MAX_SIZE)
      throw new APIException(
        EX.API_FILE_EXECEEDS_SIZE,
        `File ${fileUrl} is not valid`
      );
  }
}

/**
 * 上传文件
 *
 * @param fileUrl 文件URL
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param isVideoImage 是否是用于视频图像
 */
async function uploadFile(
  fileUrl: string,
  refreshToken: string,
  isVideoImage: boolean = false
) {
  // 预检查远程文件URL可用性
  await checkFileUrl(fileUrl);

  let filename, fileData, mimeType;
  // 如果是BASE64数据则直接转换为Buffer
  if (util.isBASE64Data(fileUrl)) {
    mimeType = util.extractBASE64DataFormat(fileUrl);
    const ext = mime.getExtension(mimeType);
    filename = `${util.uuid()}.${ext}`;
    fileData = Buffer.from(util.removeBASE64DataHeader(fileUrl), "base64");
  }
  // 下载文件到内存，如果您的服务器内存很小，建议考虑改造为流直传到下一个接口上，避免停留占用内存
  else {
    filename = path.basename(fileUrl);
    ({ data: fileData } = await axios.get(fileUrl, {
      responseType: "arraybuffer",
      // 100M限制
      maxContentLength: FILE_MAX_SIZE,
      // 60秒超时
      timeout: 60000,
    }));
  }

  // 获取文件的MIME类型
  mimeType = mimeType || mime.getType(filename);

  // 待开发
}

/**
 * 检查请求结果
 *
 * @param result 结果
 */
function checkResult(result: AxiosResponse) {
  if (!result.data) return null;
  const { code, msg, data } = result.data;
  if (!_.isFinite(code)) return result.data;
  if (code === 0) return data;
  throw new APIException(EX.API_REQUEST_FAILED, `[请求jimeng失败]: ${msg}`);
}

/**
 * 从流接收完整的消息内容
 *
 * @param stream 消息流
 */
async function receiveStream(stream: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // 消息初始化
    const data = {
      id: "",
      model: MODEL_NAME,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      created: util.unixTimestamp(),
    };
    let isEnd = false;
    const parser = createParser((event) => {
      try {
        if (event.type !== "event" || isEnd) return;
        // 解析JSON
        const rawResult = _.attempt(() => JSON.parse(event.data));
        if (_.isError(rawResult))
          throw new Error(`Stream response invalid: ${event.data}`);
        // console.log(rawResult);
        if (rawResult.code)
          throw new APIException(
            EX.API_REQUEST_FAILED,
            `[请求jimeng失败]: ${rawResult.code}-${rawResult.message}`
          );
        if (rawResult.event_type == 2003) {
          isEnd = true;
          data.choices[0].message.content =
            data.choices[0].message.content.replace(/\n$/, "");
          return resolve(data);
        }
        if (rawResult.event_type != 2001) return;
        const result = _.attempt(() => JSON.parse(rawResult.event_data));
        if (_.isError(result))
          throw new Error(`Stream response invalid: ${rawResult.event_data}`);
        if (result.is_finish) {
          isEnd = true;
          data.choices[0].message.content =
            data.choices[0].message.content.replace(/\n$/, "");
          return resolve(data);
        }
        if (!data.id && result.conversation_id)
          data.id = result.conversation_id;
        const message = result.message;
        if (!message || ![2001, 2008].includes(message.content_type)) return;
        const content = JSON.parse(message.content);
        if (content.text) data.choices[0].message.content += content.text;
      } catch (err) {
        logger.error(err);
        reject(err);
      }
    });
    // 将流数据喂给SSE转换器
    stream.on("data", (buffer) => parser.feed(buffer.toString()));
    stream.once("error", (err) => reject(err));
    stream.once("close", () => resolve(data));
  });
}

/**
 * 创建转换流
 *
 * 将流格式转换为gpt兼容流格式
 *
 * @param stream 消息流
 * @param endCallback 传输结束回调
 */
function createTransStream(stream: any, endCallback?: Function) {
  let isEnd = false;
  let convId = "";
  // 消息创建时间
  const created = util.unixTimestamp();
  // 创建转换流
  const transStream = new PassThrough();
  !transStream.closed &&
    transStream.write(
      `data: ${JSON.stringify({
        id: convId,
        model: MODEL_NAME,
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
        created,
      })}\n\n`
    );
  const parser = createParser((event) => {
    try {
      if (event.type !== "event") return;
      // 解析JSON
      const rawResult = _.attempt(() => JSON.parse(event.data));
      if (_.isError(rawResult))
        throw new Error(`Stream response invalid: ${event.data}`);
      // console.log(rawResult);
      if (rawResult.code)
        throw new APIException(
          EX.API_REQUEST_FAILED,
          `[请求jimeng失败]: ${rawResult.code}-${rawResult.message}`
        );
      if (rawResult.event_type == 2003) {
        isEnd = true;
        transStream.write(
          `data: ${JSON.stringify({
            id: convId,
            model: MODEL_NAME,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: "stop",
              },
            ],
            created,
          })}\n\n`
        );
        !transStream.closed && transStream.end("data: [DONE]\n\n");
        endCallback && endCallback(convId);
        return;
      }
      if (rawResult.event_type != 2001) return;
      const result = _.attempt(() => JSON.parse(rawResult.event_data));
      if (_.isError(result))
        throw new Error(`Stream response invalid: ${rawResult.event_data}`);
      if (!convId) convId = result.conversation_id;
      if (result.is_finish) {
        isEnd = true;
        transStream.write(
          `data: ${JSON.stringify({
            id: convId,
            model: MODEL_NAME,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "" },
                finish_reason: "stop",
              },
            ],
            created,
          })}\n\n`
        );
        !transStream.closed && transStream.end("data: [DONE]\n\n");
        endCallback && endCallback(convId);
        return;
      }
      const message = result.message;
      if (!message || ![2001, 2008].includes(message.content_type)) return;
      const content = JSON.parse(message.content);
      transStream.write(
        `data: ${JSON.stringify({
          id: convId,
          model: MODEL_NAME,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: content.text },
              finish_reason: null,
            },
          ],
          created,
        })}\n\n`
      );
    } catch (err) {
      logger.error(err);
      !transStream.closed && transStream.end("\n\n");
    }
  });
  // 将流数据喂给SSE转换器
  stream.on("data", (buffer) => parser.feed(buffer.toString()));
  stream.once(
    "error",
    () => !transStream.closed && transStream.end("data: [DONE]\n\n")
  );
  stream.once(
    "close",
    () => !transStream.closed && transStream.end("data: [DONE]\n\n")
  );
  return transStream;
}

/**
 * Token切分
 *
 * @param authorization 认证字符串
 */
function tokenSplit(authorization: string) {
  return authorization.replace("Bearer ", "").split(",");
}

/**
 * 获取Token存活状态
 */
async function getTokenLiveStatus(refreshToken: string) {
  const result = await request(
    "POST",
    "/passport/account/info/v2",
    refreshToken,
    {
      params: {
        account_sdk_source: "web",
      },
    }
  );
  try {
    const { user_id } = checkResult(result);
    return !!user_id;
  } catch (err) {
    return false;
  }
}

export default {
  createCompletion,
  createCompletionStream,
  getTokenLiveStatus,
  tokenSplit,
};
