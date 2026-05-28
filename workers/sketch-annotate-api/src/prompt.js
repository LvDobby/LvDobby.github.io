/**
 * 手绘注释图 — 图像大模型 Prompt（与前端 js/sketch-annotate.js 保持一致）
 */

/** 豆包 Seedream 图生图 / 图像编辑 Prompt */
export const DOUBAO_EDIT_PROMPT = `请在我上传的原图基础上编辑，保留原图主体、构图、光线与色彩，不要替换成不同场景。请观察照片中的元素，并为每个元素添加有意义的手绘注释。

【画面里的东西】
把照片里的物品简单列出来（比如：冰美式、面包、窗边、阳光）

【画法要求】
・用白色细线，像手绘笔一样
・一笔画风格，线条随意一点，不要太工整
・沿着物体边缘轻轻描一圈轮廓
・适当加箭头 / 虚线，引导视线

【文字风格】
・中文手写感，偏口语一点
・句子要短，像随手写的
・语气像日常碎碎念 / 小情绪

【内容怎么写】
・饮品 → 味道 / 温度 / 当下感觉（例：冰冰的，好清爽）
・食物 → 口感 / 好不好吃（例：软软的，有点惊喜）
・环境 → 氛围（例：有点安静，很适合发呆）
・整体 → 一句总结（例：今天也算被治愈了）

【小装饰】
・可以加一点点：热气、小星星、爱心、简单表情（比如：:)）
・不要太多，留一点空白更好看

【整体感觉】
・像小红书日常分享 / 随手记录
・自然、不用太精致，有点松弛感`;

export const SKETCH_PROMPT = DOUBAO_EDIT_PROMPT;

/** Recraft 模型适用：短 prompt 更稳定 */
export const RECRAFT_EDIT_PROMPT =
  'Edit this photo in place — keep the original scene, people, colors and layout. ' +
  'Add white hand-drawn sketch outlines along each object edge, short casual Chinese handwritten notes ' +
  '(drink taste/temperature, food texture, ambient mood, one closing line), a few arrows/dashes, tiny stars/hearts/steam. ' +
  'Xiaohongshu casual diary style, loose and natural. Do not replace or regenerate the photo.';

/** Gemini 等通用编辑 Prompt */
export const EDIT_PROMPT =
  '【任务】图像编辑：在原图基础上叠加手绘注释，输出编辑后的完整图片。\n' +
  '【硬性要求】\n' +
  '1. 必须基于我上传的原图修改，保留原图主体、构图、光线与色彩\n' +
  '2. 为画面中每个主要元素分别添加有意义的手绘注释（轮廓线 + 短文案 + 少量装饰）\n' +
  '3. 不要整图重绘、不要换场景、不要改变原图内容\n\n' +
  DOUBAO_EDIT_PROMPT;
