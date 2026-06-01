/**
 * PTLF Parser Module
 * Mimics the Java PTLFXParser logic for parsing Payment Transaction Logging Format
 */

const logger = {
    error: (msg, ...args) => console.error(`[PTLF Parser Error] ${msg}`, ...args),
    debug: (msg, ...args) => console.log(`[PTLF Parser] ${msg}`, ...args),
    info: (msg, ...args) => console.log(`[PTLF Parser] ${msg}`, ...args)
};

/**
 * Get fixed field from token value by position
 */
function getFixedField(tokenValue, startPos, endPos) {
    if (!tokenValue || tokenValue.length === 0) {
        return "";
    }
    if (tokenValue.length < startPos) {
        return "";
    }
    if (tokenValue.length < endPos) {
        return tokenValue.substring(startPos);
    }
    return tokenValue.substring(startPos, endPos);
}

/**
 * Strip leading zeros from a string
 */
function stripLeadingZeros(s) {
    if (!s) return s;
    return s.replace(/^0+(?!$)/, '');
}

/**
 * Parse token data from the main token section
 */
function parseTokenData(tokenString) {
    const tokensMap = {};
    try {
        if (!tokenString || tokenString.trim().length < 12) return tokensMap;
        
        const numTokens = tokenString.substring(2, 7);
        const totalLengthTokens = tokenString.substring(7, 12);
        tokensMap.tokens_count = numTokens;
        tokensMap.tokens_length = totalLengthTokens;
        
        const tokensStr = tokenString.substring(12);
        parseTokens(tokensStr, tokensMap);
        
        return tokensMap;
    } catch (err) {
        logger.error(`Error parsing token data: ${err.message}`);
        return tokensMap;
    }
}

/**
 * Parse individual tokens recursively
 */
function parseTokens(tokensStr, tokensMap) {
    if (!tokensStr || tokensStr.trim().length === 0) return;
    
    try {
        if (!tokensStr.startsWith('! ')) {
            return;
        }
        
        const tokenName = tokensStr.substring(2, 4);
        const tokenLength = parseInt(tokensStr.substring(4, 9));
        let tokenValue = '';
        let remaining = '';
        
        if (tokensStr.length > 10 + tokenLength) {
            tokenValue = tokensStr.substring(10, 10 + tokenLength);
            remaining = tokensStr.substring(10 + tokenLength);
        } else {
            tokenValue = tokensStr.substring(10);
            remaining = '';
        }
        
        tokensMap[`token_${tokenName}`] = tokenValue;
        parseTokens(remaining, tokensMap);
    } catch (err) {
        logger.error(`Error parsing tokens: ${err.message}`);
    }
}

/**
 * Parse SN token tags
 */
function parseSnTokenTags(tokenSn) {
    const tokensMap = {};
    if (!tokenSn || tokenSn.trim().length <= 6) return tokensMap;
    
    try {
        const tokensStr = tokenSn.substring(6);
        parseSnTokens(tokensStr, tokensMap);
    } catch (err) {
        logger.error(`Error parsing SN tokens: ${err.message}`);
    }
    return tokensMap;
}

/**
 * Parse SN tokens recursively
 */
function parseSnTokens(tokensStr, tokensMap) {
    if (!tokensStr || tokensStr.trim().length === 0) return;
    
    try {
        const tokenName = tokensStr.substring(0, 2);
        const tokenLength = parseInt(tokensStr.substring(2, 5));
        let tokenValue = '';
        let remaining = '';
        
        if (tokensStr.length > 5 + tokenLength) {
            tokenValue = tokensStr.substring(5, 5 + tokenLength);
            remaining = tokensStr.substring(5 + tokenLength);
        } else {
            tokenValue = tokensStr.substring(5);
            remaining = '';
        }
        
        tokensMap[`token_SN_tag_${tokenName}`] = tokenValue;
        parseSnTokens(remaining, tokensMap);
    } catch (err) {
        logger.error(`Error parsing SN tokens: ${err.message}`);
    }
}

/**
 * Parse B0 token tags (BNET format)
 */
function parseB0TokenTags(tokenB0) {
    const tokensMap = {};
    if (!tokenB0) return tokensMap;
    
    try {
        // Check if it's a BNET token
        const fiid = getFixedField(tokenB0, 4, 8);
        if (fiid !== 'BNET') return tokensMap;
        
        let pos = 0;
        tokensMap.LGTH = getFixedField(tokenB0, pos, pos + 3);
        tokensMap.USERFLD1 = getFixedField(tokenB0, pos + 3, pos + 4);
        tokensMap.FIID = getFixedField(tokenB0, pos + 4, pos + 8);
        tokensMap.VERID = getFixedField(tokenB0, pos + 8, pos + 10);
        tokensMap.LOCALTIM = getFixedField(tokenB0, pos + 10, pos + 16);
        tokensMap.LOCALDAT = getFixedField(tokenB0, pos + 16, pos + 20);
        tokensMap.ADVICERSNCDE = getFixedField(tokenB0, pos + 20, pos + 23);
        tokensMap.POSENTRYMDE = getFixedField(tokenB0, pos + 23, pos + 26);
        tokensMap.RESPCDE = getFixedField(tokenB0, pos + 26, pos + 28);
        tokensMap.CARDVRFYRESULT = getFixedField(tokenB0, pos + 28, pos + 29);
        
        // Extract card number (positions 164-180)
        const cardNumber = getFixedField(tokenB0, 164, 180);
        if (cardNumber && cardNumber.trim()) {
            tokensMap.CARD_NUMBER = cardNumber;
            tokensMap.masked_card_number = maskPAN(cardNumber);
        }
        
    } catch (err) {
        logger.error(`Error parsing B0 token: ${err.message}`);
    }
    return tokensMap;
}

/**
 * Parse QP token tags (ISO8583 fields)
 */
function parseQPTokenTags(tokenQP) {
    const tokensMap = {};
    if (!tokenQP) return tokensMap;
    
    try {
        let pos = 0;
        tokensMap.DE015 = getFixedField(tokenQP, pos, pos + 4);      // Settlement Amount
        pos = pos + 4;
        tokensMap.DE018 = getFixedField(tokenQP, pos, pos + 4);      // Merchant Type
        pos = pos + 4;
        tokensMap.DE022 = getFixedField(tokenQP, pos, pos + 3);      // POS Entry Mode
        pos = pos + 3;
        tokensMap.DE025 = getFixedField(tokenQP, pos, pos + 2);      // POS Condition Code
        pos = pos + 2;
        tokensMap.DE042 = getFixedField(tokenQP, pos, pos + 14);     // Card Acceptor ID
        pos = pos + 14;
        tokensMap.DE043 = getFixedField(tokenQP, pos, pos + 40);     // Card Acceptor Name/Location
        pos = pos + 40;
        tokensMap.DE048 = getFixedField(tokenQP, pos, pos + 25);     // Additional Data
        pos = pos + 25;
        tokensMap.DE057 = getFixedField(tokenQP, pos, pos + 3);      // Approval Code
        pos = pos + 3;
        tokensMap.DE058 = getFixedField(tokenQP, pos, pos + 11);     // Settlement Date
        pos = pos + 11;
        tokensMap.DE060 = getFixedField(tokenQP, pos, pos + 6);      // POS Data
        pos = pos + 6;
        tokensMap.DE062 = getFixedField(tokenQP, pos, pos + 14);     // Transport Data
        pos = pos + 14;
        tokensMap.DE070 = getFixedField(tokenQP, pos, pos + 3);      // Network Management Code
        pos = pos + 3;
        tokensMap.DE090 = getFixedField(tokenQP, pos, pos + 42);     // Original Data Elements
        pos = pos + 42;
        tokensMap.DE105 = getFixedField(tokenQP, pos, pos + 60);     // Additional Data
        pos = pos + 60;
        tokensMap.DE120 = getFixedField(tokenQP, pos, pos + 1);      // Terminal Type
        pos = pos + 1;
        tokensMap.DE122 = getFixedField(tokenQP, pos, pos + 11);     // Terminal ID
        pos = pos + 11;
        tokensMap.DE123 = getFixedField(tokenQP, pos, pos + 37);     // Card Acquirer Data
        pos = pos + 37;
        tokensMap.RQST_PRI_BITMAP = getFixedField(tokenQP, pos, pos + 16);
        pos = pos + 16;
        tokensMap.RQST_SEC_BITMAP = getFixedField(tokenQP, pos, pos + 16);
        pos = pos + 16;
        tokensMap.RESP_PRI_BITMAP = getFixedField(tokenQP, pos, pos + 16);
        pos = pos + 16;
        tokensMap.RESP_SEC_BITMAP = getFixedField(tokenQP, pos, pos + 16);
        
    } catch (err) {
        logger.error(`Error parsing QP token: ${err.message}`);
    }
    return tokensMap;
}

/**
 * Parse QS token tags (Timing data)
 */
function parseQSTokenTags(tokenQS) {
    const tokensMap = {};
    if (!tokenQS) return tokensMap;
    
    try {
        let pos = 0;
        tokensMap.entry_ts = getFixedField(tokenQS, pos, pos + 17);
        pos = pos + 17;
        tokensMap.exit_ts = getFixedField(tokenQS, pos, pos + 17);
        pos = pos + 17;
        tokensMap.extrn_acq_queue_tim = stripLeadingZeros(getFixedField(tokenQS, pos, pos + 5));
        pos = pos + 5;
        tokensMap.extrn_acq_tim = stripLeadingZeros(getFixedField(tokenQS, pos, pos + 5));
        pos = pos + 5;
        tokensMap.extrn_iss_tim = stripLeadingZeros(getFixedField(tokenQS, pos, pos + 5));
        pos = pos + 5;
        tokensMap.extrn_iss_queue_tim = stripLeadingZeros(getFixedField(tokenQS, pos, pos + 5));
        pos = pos + 5;
        tokensMap.intern_tim = stripLeadingZeros(getFixedField(tokenQS, pos, pos + 5));
        
    } catch (err) {
        logger.error(`Error parsing QS token: ${err.message}`);
    }
    return tokensMap;
}

/**
 * Parse QC token tags (Variable length fields)
 */
function parseQCTokenTags(tokenQC) {
    const tokensMap = {};
    if (!tokenQC) return tokensMap;
    
    try {
        let pos = 0;
        const numberFields = ['07', '08', '09', '10', '11'];
        
        while (pos + 3 < tokenQC.length) {
            const tokenId = getFixedField(tokenQC, pos, pos + 2);
            const tokenLengthStr = getFixedField(tokenQC, pos + 2, pos + 5);
            const tokenLength = parseInt(tokenLengthStr);
            
            let tokenValue = getFixedField(tokenQC, pos + 5, pos + 5 + tokenLength);
            if (numberFields.includes(tokenId)) {
                tokenValue = stripLeadingZeros(tokenValue);
            }
            tokensMap[`field_${tokenId}`] = tokenValue;
            pos = pos + 5 + tokenLength;
        }
    } catch (err) {
        logger.error(`Error parsing QC token: ${err.message}`);
    }
    return tokensMap;
}

/**
 * Parse BE token tags (Currency conversion)
 */
function parseBeTokenTags(tokenBe) {
    const tokensMap = {};
    if (!tokenBe) return tokensMap;
    
    try {
        let pos = 0;
        tokensMap.AMT1 = getFixedField(tokenBe, pos, pos + 19);       // Amount 1
        pos = pos + 19;
        tokensMap.AMT2 = getFixedField(tokenBe, pos, pos + 19);       // Amount 2
        pos = pos + 19;
        tokensMap.CRNCYCDE = getFixedField(tokenBe, pos, pos + 3);    // Currency Code
        pos = pos + 3;
        tokensMap.CONVRATE = getFixedField(tokenBe, pos, pos + 8);    // Conversion Rate
        pos = pos + 8;
        tokensMap.CONVDAT = getFixedField(tokenBe, pos, pos + 4);     // Conversion Date
        pos = pos + 4;
        tokensMap.CONVIND = getFixedField(tokenBe, pos, pos + 1);     // Conversion Indicator
        pos = pos + 1;
        tokensMap.USERFLD1 = getFixedField(tokenBe, pos, pos + 8);    // User Field
        
    } catch (err) {
        logger.error(`Error parsing BE token: ${err.message}`);
    }
    return tokensMap;
}

/**
 * Mask PAN (show first 6 and last 4)
 */
function maskPAN(pan) {
    if (!pan || pan.length < 10) return pan;
    const panStr = pan.toString();
    if (panStr.length <= 10) return panStr;
    return `${panStr.substring(0, 6)}******${panStr.substring(panStr.length - 4)}`;
}

/**
 * Main PTLF Record Parser - parses complete PTLF record
 * Similar to Java's ptlfxParser.parseWithTokensToMap()
 * 
 * @param {string} recordData - Raw PTLF record data (already stripped of header)
 * @param {number} fixedLengthBeforeTokens - Fixed length before token section (default: 85 from their code)
 * @returns {object} Parsed record with all tokens extracted as a flat map
 */
function parseWithTokensToMap(recordData, fixedLengthBeforeTokens = 85) {
    const resultMap = {};
    
    try {
        if (!recordData || recordData.length === 0) {
            logger.error("No record data provided");
            return resultMap;
        }
        
        logger.debug(`Parsing PTLF record, length: ${recordData.length}`);
        
        // Parse fixed length header part (first 85 characters)
        if (recordData.length > fixedLengthBeforeTokens) {
            const fixedPart = recordData.substring(0, fixedLengthBeforeTokens);
            
            // Extract common fields from fixed part
            if (fixedPart.length >= 6) {
                resultMap.stan = fixedPart.substring(0, 6);
            }
            if (fixedPart.length >= 18) {
                resultMap.rrn = fixedPart.substring(6, 18);
            }
            if (fixedPart.length >= 30) {
                resultMap.amount = fixedPart.substring(18, 30);
            }
            
            // Store the fixed part for reference
            resultMap.fixed_header = fixedPart;
        }
        
        // Parse token data (after the fixed header)
        if (recordData.length > fixedLengthBeforeTokens) {
            const tokenSection = recordData.substring(fixedLengthBeforeTokens);
            const tokens = parseTokenData(tokenSection);
            
            // Flatten all tokens into the result map
            for (const [key, value] of Object.entries(tokens)) {
                resultMap[key] = value;
            }
            
            // Parse specific token types and add their fields to the result map
            if (tokens.token_SN) {
                const snTokens = parseSnTokenTags(tokens.token_SN);
                for (const [key, value] of Object.entries(snTokens)) {
                    resultMap[key] = value;
                }
            }
            
            if (tokens.token_B0) {
                const b0Tokens = parseB0TokenTags(tokens.token_B0);
                for (const [key, value] of Object.entries(b0Tokens)) {
                    resultMap[`B0_${key}`] = value;
                }
                // Extract masked card number
                if (b0Tokens.masked_card_number) {
                    resultMap.masked_pan = b0Tokens.masked_card_number;
                }
                if (b0Tokens.CARD_NUMBER) {
                    resultMap.pan = maskPAN(b0Tokens.CARD_NUMBER);
                }
            }
            
            if (tokens.token_QP) {
                const qpTokens = parseQPTokenTags(tokens.token_QP);
                for (const [key, value] of Object.entries(qpTokens)) {
                    resultMap[`QP_${key}`] = value;
                }
                // Extract amount from QP token
                if (qpTokens.DE015) {
                    resultMap.settlement_amount = qpTokens.DE015;
                }
            }
            
            if (tokens.token_QS) {
                const qsTokens = parseQSTokenTags(tokens.token_QS);
                for (const [key, value] of Object.entries(qsTokens)) {
                    resultMap[`QS_${key}`] = value;
                }
            }
            
            if (tokens.token_QC) {
                const qcTokens = parseQCTokenTags(tokens.token_QC);
                for (const [key, value] of Object.entries(qcTokens)) {
                    resultMap[`QC_${key}`] = value;
                }
            }
            
            if (tokens.token_BE) {
                const beTokens = parseBeTokenTags(tokens.token_BE);
                for (const [key, value] of Object.entries(beTokens)) {
                    resultMap[`BE_${key}`] = value;
                }
                // Extract amount from BE token
                if (beTokens.AMT1) {
                    resultMap.converted_amount = beTokens.AMT1;
                }
            }
        }
        
        logger.debug(`Parsed ${Object.keys(resultMap).length} fields from PTLF record`);
        
    } catch (err) {
        logger.error(`Error parsing PTLF record: ${err.message}`);
        resultMap.parse_error = err.message;
    }
    
    return resultMap;
}

/**
 * Simplified parser that returns the raw parsed structure
 */
function parsePTLFRecord(recordData, fixedLengthBeforeTokens = 85) {
    return parseWithTokensToMap(recordData, fixedLengthBeforeTokens);
}

// Export all functions for use in other modules
module.exports = {
    parsePTLFRecord,
    parseWithTokensToMap,
    parseTokenData,
    parseB0TokenTags,
    parseQPTokenTags,
    parseQSTokenTags,
    parseQCTokenTags,
    parseBeTokenTags,
    parseSnTokenTags,
    maskPAN
};