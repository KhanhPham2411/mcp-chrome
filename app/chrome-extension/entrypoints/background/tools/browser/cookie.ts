import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface GetCookieToolParams {
  url: string;
}

/**
 * Tool for getting cookies from a specified website
 */
class GetCookieTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_COOKIE;

  async execute(args: GetCookieToolParams): Promise<ToolResult> {
    const { url } = args;

    console.log(`Attempting to get cookies from URL: ${url}`);

    try {
      // Validate URL format
      if (!url || !url.startsWith('http')) {
        return createErrorResponse('Valid URL starting with http:// or https:// is required');
      }

      // Parse the URL to get the domain
      let domain: string;
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname;
      } catch (error) {
        return createErrorResponse('Invalid URL format provided');
      }

      console.log(`Getting cookies for domain: ${domain}`);

      // Get all cookies for the domain
      const cookies = await chrome.cookies.getAll({ domain });

      if (!cookies || cookies.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `No cookies found for domain: ${domain}`,
                url: url,
                domain: domain,
                cookies: [],
                cookieString: '',
              }),
            },
          ],
          isError: false,
        };
      }

      // Format cookies as a string (similar to document.cookie format)
      const cookieStrings = cookies.map((cookie) => {
        // Handle cookies with empty values
        const value = cookie.value || '';
        return `${cookie.name}=${value}`;
      });

      const cookieString = cookieStrings.join('; ');

      console.log(`Found ${cookies.length} cookies for domain: ${domain}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Successfully retrieved ${cookies.length} cookies from ${domain}`,
              url: url,
              domain: domain,
              cookies: cookies.map((cookie) => ({
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain,
                path: cookie.path,
                secure: cookie.secure,
                httpOnly: cookie.httpOnly,
                expirationDate: cookie.expirationDate,
                sameSite: cookie.sameSite,
              })),
              cookieString: cookieString,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error getting cookies for URL ${url}:`, errorMessage);

      return createErrorResponse(`Failed to get cookies: ${errorMessage}`);
    }
  }
}

export const getCookieTool = new GetCookieTool();
