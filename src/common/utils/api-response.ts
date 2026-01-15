export class ApiResponse {
  static success(message: string, statusCode: number, data: any = null) {
    return {
      message,
      status_code: statusCode,
      data,
    };
  }

  static error(message: string, statusCode: number, data: any = null) {
    return {
      message,
      status_code: statusCode,
      data,
    };
  }
}
