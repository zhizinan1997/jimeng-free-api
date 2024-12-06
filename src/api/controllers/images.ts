import _ from "lodash";

import util from "@/lib/util.ts";
import { request } from "./core.ts";

const DEFAULT_ASSISTANT_ID = "513695";
const DEFAULT_MODEL = "jimeng-2.1";
const MODEL_MAP = {
  "jimeng-2.1": "high_aes_general_v21_L:general_v2.1_L",
  "jimeng-2.0-pro": "high_aes_general_v20_L:general_v2.0_L",
  "jimeng-2.0": "high_aes_general_v20:general_v2.0",
  "jimeng-1.4": "high_aes_general_v14:general_v1.4",
  "jimeng-xl-pro": "text2img_xl_sft",
};

export function getModel(model: string) {
  return MODEL_MAP[model] || MODEL_MAP[DEFAULT_MODEL];
}

export async function generateImages(model: string, prompt: string, refreshToken: string) {
  model = getModel(model);
  const componentId = util.uuid();
  const result = await  request("post", "/mweb/v1/aigc_draft/generate", refreshToken, {
    params: {
      babi_param: encodeURIComponent(
        JSON.stringify({
          scenario: "image_video_generation",
          feature_key: "aigc_to_image",
          feature_entrance: "to_image",
          feature_entrance_detail:
            "to_image-" + model,
        })
      ),
    },
    data: {
      extend: {
        root_model: model,
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
        id: util.uuid(),
        min_version: "3.0.2",
        is_from_tsn: true,
        version: "3.0.2",
        main_component_id: componentId,
        component_list: [
          {
            type: "image_base_component",
            id: componentId,
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
                  model,
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
        aid: Number(DEFAULT_ASSISTANT_ID),
      },
    },
  });
  console.log(result);
  return result;
}

export default {
  generateImages
};
