import _ from 'lodash';
import { createParser } from 'eventsource-parser';
import { PassThrough } from 'stream';

import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';
import logger from '@/lib/logger.ts';
import util from '@/lib/util.ts';
import { request, uploadFile } from './core.ts';

// 模型名称
const MODEL_NAME = "jimeng";
// 默认的AgentID
const DEFAULT_ASSISTANT_ID = "513695";
// 最大重试次数
const MAX_RETRY_COUNT = 3;
// 重试延迟
const RETRY_DELAY = 5000;

/**
 * 移除会话
 *
 * 在对话流传输完毕后移除会话，避免创建的会话出现在用户的对话列表中
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function removeConversation(convId: string, refreshToken: string) {
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
export async function createCompletion(
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
export async function createCompletionStream(
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
export function extractRefFileUrls(messages: any[]) {
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
export function messagesPrepare(messages: any[], refs: any[], isRefConv = false) {
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
 * 从流接收完整的消息内容
 *
 * @param stream 消息流
 */
export async function receiveStream(stream: any): Promise<any> {
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
export function createTransStream(stream: any, endCallback?: Function) {
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
