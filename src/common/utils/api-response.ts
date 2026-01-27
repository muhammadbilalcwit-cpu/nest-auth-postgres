import { ApiResponseData } from '../interfaces/api-response.interface';

// Re-export for backward compatibility
export { ApiResponseData } from '../interfaces/api-response.interface';

export class ApiResponse {
  static success(
    message: string,
    statusCode: number,
    data: unknown = null,
  ): ApiResponseData {
    return {
      message,
      status_code: statusCode,
      data,
    };
  }

  static error(
    message: string,
    statusCode: number,
    data: unknown = null,
  ): ApiResponseData {
    return {
      message,
      status_code: statusCode,
      data,
    };
  }
}
