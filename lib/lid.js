// lid to pn
async function lidToPhone(conn, lid) {
    try {
        const pn = await conn.signalRepository.lidMapping.getPNForLID(lid);
        if (pn) {
            return cleanPN(pn);
        }
        return lid.split("@")[0];
    } catch (e) {
        return lid.split("@")[0];
    }
}

// cleanPn
function cleanPN(pn) {
    return pn.split(":")[0];
}

module.exports = { 
    lidToPhone, 
    cleanPN 
};