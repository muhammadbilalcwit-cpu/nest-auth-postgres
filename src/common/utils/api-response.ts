export interface ApiResponseData {
  message: string;
  status_code: number;
  data: unknown;
}

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
