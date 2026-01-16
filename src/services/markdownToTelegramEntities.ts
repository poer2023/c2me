import { marked, Token, TokensList, Tokens } from 'marked';

// Define the MessageEntity interface based on Telegram's types
export interface MessageEntity {
    type: string; // e.g., 'messageEntityBold'
    offset: number;
    length: number;
    url?: string;
    language?: string;
    // user_id?: number; // For messageEntityMentionName - not covered in standard Markdown
    // document_id?: string; // For messageEntityCustomEmoji - not covered in standard Markdown
}

export interface ParseResult {
    text: string;
    entities: MessageEntity[];
}

// Helper function to get UTF-16 length (used by Telegram for offsets and lengths)
// For standard JavaScript strings, str.length is already UTF-16 code units count.
// This function is kept for clarity and potential future needs if string handling becomes more complex.
export function getUtf16Length(str: string): number {
    return str.length;
}

// Pre-process spoiler syntax (||text||) before marked parsing
// Returns the text with spoiler markers removed and tracks their positions
interface SpoilerInfo {
    originalStart: number;
    content: string;
}

function extractSpoilers(text: string): { cleanedText: string; spoilers: SpoilerInfo[] } {
    const spoilers: SpoilerInfo[] = [];
    const spoilerRegex = /\|\|(.+?)\|\|/g;
    let match;

    // Collect all spoiler matches
    while ((match = spoilerRegex.exec(text)) !== null) {
        if (match[1]) {
            spoilers.push({ originalStart: match.index, content: match[1] });
        }
    }

    // Remove spoiler markers (||) from text, keeping the content
    const cleanedText = text.replace(/\|\|(.+?)\|\|/g, '$1');

    return { cleanedText, spoilers };
}

// Post-process to add spoiler entities by finding content in plain text
function addSpoilerEntities(
    plainText: string,
    originalText: string,
    entities: MessageEntity[]
): void {
    const spoilerRegex = /\|\|(.+?)\|\|/g;
    let match;

    // Find each spoiler in the original text
    while ((match = spoilerRegex.exec(originalText)) !== null) {
        const spoilerContent = match[1];
        if (!spoilerContent) continue;

        // Find this content in the plain text
        // We need to search for the actual text content (may have been transformed by markdown)
        // For simplicity, search for the literal content
        let searchStart = 0;
        let found = plainText.indexOf(spoilerContent, searchStart);

        // Check if this position is already covered by another spoiler entity
        // to avoid duplicates when same content appears multiple times
        while (found !== -1) {
            const existingSpoiler = entities.find(
                e => e.type === 'messageEntitySpoiler' &&
                    e.offset === found &&
                    e.length === spoilerContent.length
            );

            if (!existingSpoiler) {
                entities.push({
                    type: 'messageEntitySpoiler',
                    offset: found,
                    length: spoilerContent.length,
                });
                break;
            }

            // Search for next occurrence
            searchStart = found + 1;
            found = plainText.indexOf(spoilerContent, searchStart);
        }
    }
}

export function markdownToTelegramEntities(markdownText: string): ParseResult {
    // Store original text for spoiler processing
    const originalText = markdownText;

    // Pre-process: remove spoiler markers but keep content for markdown parsing
    const { cleanedText } = extractSpoilers(markdownText);

    const tokens = marked.lexer(cleanedText, { gfm: true, breaks: true });

    let plainText = '';
    const entities: MessageEntity[] = [];

    function processTokens(tokenList: Token[] | TokensList | undefined) {
        // TokensList for top-level
        if (!tokenList) {
            return;
        }

        // marked.lexer returns TokensList, which is an array with a 'links' property.
        // We only want to iterate over the array part.
        const iterableTokens = Array.isArray(tokenList) ? tokenList : [];

        for (const token of iterableTokens) {
            const startOffset = getUtf16Length(plainText);

            let entityType: string | null = null;
            const entityProps: Partial<MessageEntity> = {};

            switch (token.type) {
                case 'paragraph':
                    processTokens((token as Tokens.Paragraph).tokens);
                    // Add line break after paragraph unless it's the last token
                    if (iterableTokens.indexOf(token) < iterableTokens.length - 1) {
                        plainText += '\n\n';
                    }
                    break;
                case 'strong':
                    entityType = 'messageEntityBold';
                    processTokens((token as Tokens.Strong).tokens);
                    break;
                case 'em':
                    entityType = 'messageEntityItalic';
                    processTokens((token as Tokens.Em).tokens);
                    break;
                case 'del':
                    entityType = 'messageEntityStrike';
                    processTokens((token as Tokens.Del).tokens);
                    break;
                case 'codespan':
                    entityType = 'messageEntityCode';
                    plainText += (token as Tokens.Codespan).text;
                    break;
                case 'code': {
                    // Fenced code block - Added block scope
                    entityType = 'messageEntityPre';
                    const codeToken = token as Tokens.Code;
                    // Ensure language is always set, even if empty
                    entityProps.language = codeToken.lang?.trim() || '';

                    let codeText = codeToken.text;
                    // Normalize line endings from marked's output
                    codeText = codeText.replace(/\r\n/g, '\n');
                    codeText = codeText.replace(/\r/g, '\n');

                    plainText += codeText;
                    break;
                }
                case 'link': {
                    entityType = 'messageEntityTextUrl';
                    const linkToken = token as Tokens.Link;
                    entityProps.url = linkToken.href;
                    processTokens(linkToken.tokens);
                    break;
                }
                case 'blockquote': {
                    const bqToken = token as Tokens.Blockquote;
                    // Check if it's an expandable blockquote (>>> prefix)
                    const rawText = bqToken.raw || '';
                    const isExpandable = rawText.startsWith('>>>');
                    entityType = isExpandable ? 'messageEntityExpandableBlockquote' : 'messageEntityBlockquote';

                    if (bqToken.tokens) {
                        const childTokens = bqToken.tokens;
                        childTokens.forEach((childToken: Token, index: number) => {
                            const textBeforeChild = plainText;
                            processTokens([childToken]);
                            if (
                                plainText.length > textBeforeChild.length &&
                                index < childTokens.length - 1
                            ) {
                                const nextToken = childTokens[index + 1];
                                if (
                                    nextToken &&
                                    [
                                        'paragraph',
                                        'list',
                                        'blockquote',
                                        'code',
                                        'heading',
                                    ].includes(nextToken.type)
                                ) {
                                    plainText += '\n';
                                }
                            }
                        });
                    }
                    break;
                }
                case 'list': {
                    const listToken = token as Tokens.List;

                    if (plainText && !plainText.endsWith('\n')) {
                        plainText += '\n';
                    }

                    const before = plainText.length;

                    listToken.items.forEach((item, index) => {
                        plainText += listToken.ordered ? `${index + 1}. ` : '•  ';

                        processTokens(item.tokens);

                        plainText = plainText.replace(/\n+$/, '');
                        plainText += '\n';
                    });

                    if (plainText.length > before) {
                        plainText = plainText.replace(/\n$/, '\n\n');
                    }

                    plainText = plainText.replace(/\n{3,}/g, '\n\n');
                    break;
                }
                case 'heading':
                    entityType = 'messageEntityBold';
                    processTokens((token as Tokens.Heading).tokens);
                    // Add line break after heading unless it's the last token
                    if (iterableTokens.indexOf(token) < iterableTokens.length - 1) {
                        plainText += '\n\n';
                    }
                    break;
                case 'hr':
                    break;
                case 'br':
                    plainText += '\n';
                    break;
                case 'text':
                    if ((token as Tokens.Text).tokens) {
                        processTokens((token as Tokens.Text).tokens);
                    } else {
                        plainText += (token as Tokens.Text).text;
                    }
                    break;
                case 'html':
                    break;
                case 'space': {
                    break;
                }
                default:
                    // Attempt to handle generic tokens with 'tokens' or 'text' properties
                    if (
                        'tokens' in token &&
                        token.tokens &&
                        Array.isArray(token.tokens)
                    ) {
                        processTokens(token.tokens);
                    } else if ('text' in token && typeof token.text === 'string') {
                        plainText += token.text;
                    }
                    break;
            }

            if (entityType) {
                const currentTextLength = getUtf16Length(plainText) - startOffset;

                if (currentTextLength > 0) {
                    entities.push({
                        type: entityType,
                        offset: startOffset,
                        length: currentTextLength,
                        ...entityProps,
                    } as MessageEntity);
                }
            }
        }
    }

    processTokens(tokens); // Pass the top-level TokensList here

    // Post-process: add spoiler entities based on original text markers
    addSpoilerEntities(plainText, originalText, entities);

    return { text: plainText, entities };
}