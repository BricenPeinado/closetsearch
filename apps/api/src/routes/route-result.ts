export interface JsonRouteResult {
  body: unknown;
  headers?: Record<string, string>;
  kind: "json";
  statusCode: number;
}

export interface TextRouteResult {
  body: string;
  headers: Record<string, string>;
  kind: "text";
  statusCode: number;
}

export type RouteResult = JsonRouteResult | TextRouteResult;
