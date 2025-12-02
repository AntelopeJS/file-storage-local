import { HTTPResult, RequestContext } from '@ajs/api/beta';
declare const FileStorageController_base: import("@ajs/api/beta").ControllerClass<object>;
export declare class FileStorageController extends FileStorageController_base {
    handleUpload(token: string, contentType: string | undefined, contentLength: string | undefined, body: Buffer, context: RequestContext): Promise<HTTPResult>;
    handleDownload(token: string | undefined, context: RequestContext): Promise<HTTPResult>;
}
export {};
