
// data/antidel.js
const { DATABASE } = require('../lib/database');
const { DataTypes } = require('sequelize');

const AntiDelDB = DATABASE.define('AntiDelete', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: false,
        defaultValue: 1,
    },
    gc_status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    dm_status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    status_status: { // ✅ New column for stories
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
}, {
    tableName: 'antidelete',
    timestamps: false,
    hooks: {
        beforeCreate: record => { record.id = 1; },
        beforeBulkCreate: records => { records.forEach(record => { record.id = 1; }); },
    },
});

let isInitialized = false;

async function initializeAntiDeleteSettings() {
    if (isInitialized) return;
    try {
        // Create table if it doesn't exist (safe, never duplicates)
        await AntiDelDB.sync({ force: false });

        // Manually add missing columns instead of alter:true (avoids UNIQUE constraint crash)
        const qi = DATABASE.getQueryInterface();
        const tableDesc = await qi.describeTable('antidelete');
        if (!tableDesc.status_status) {
            await qi.addColumn('antidelete', 'status_status', {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            });
        }

        await AntiDelDB.findOrCreate({
            where: { id: 1 },
            defaults: { gc_status: false, dm_status: false, status_status: false },
        });
        isInitialized = true;
    } catch (error) {
        console.error('Error initializing anti-delete settings:', error);
    }
}

async function setAnti(type, status) {
    try {
        await initializeAntiDeleteSettings();
        const record = await AntiDelDB.findByPk(1);
        if (!record) return false;

        if (type === 'gc') record.gc_status = status;
        else if (type === 'dm') record.dm_status = status;
        else if (type === 'status') record.status_status = status; // ✅ Handle status toggle
        
        await record.save();
        return true;
    } catch (error) {
        console.error('Error setting anti-delete status:', error);
        return false;
    }
}

async function getAnti(type) {
    try {
        await initializeAntiDeleteSettings();
        const record = await AntiDelDB.findByPk(1);
        if (!record) return false;

        if (type === 'gc') return record.gc_status;
        if (type === 'dm') return record.dm_status;
        if (type === 'status') return record.status_status; // ✅ Handle status toggle

        return false;
    } catch (error) {
        return false;
    }
}

async function getAllAntiDeleteSettings() {
    try {
        await initializeAntiDeleteSettings();
        const record = await AntiDelDB.findByPk(1);
        return [{
            gc_status: !!record.gc_status,
            dm_status: !!record.dm_status,
            status_status: !!record.status_status
        }];
    } catch (error) {
        return [];
    }
}

module.exports = {
    AntiDelDB,
    initializeAntiDeleteSettings,
    setAnti,
    getAnti,
    getAllAntiDeleteSettings,
};
