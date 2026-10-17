import {createPreviewHandler} from '../lib/preview-api.mjs';
const handler=createPreviewHandler();
export default {fetch:handler};
export const GET=handler;
export const POST=handler;
export const DELETE=handler;
