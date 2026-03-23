const Sequelize = require('sequelize');

class DatabaseManager {
    static instance = null;

    static getInstance() {
        if (!DatabaseManager.instance) {
            const DATABASE_URL = process.env.DATABASE_URL || './database.db';
            const isPostgres = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://');

            DatabaseManager.instance = isPostgres
                ? new Sequelize(DATABASE_URL, {
                        dialect: 'postgres',
                        ssl: true,
                        protocol: 'postgres',
                        dialectOptions: {
                            native: true,
                            ssl: { require: true, rejectUnauthorized: false },
                        },
                        logging: false,
                  })
                : new Sequelize({
                        dialect: 'sqlite',
                        storage: DATABASE_URL,
                        logging: false,
                  });
        }
        return DatabaseManager.instance;
    }
}

const DATABASE = DatabaseManager.getInstance();

DATABASE.sync()
    .then(() => {
        console.log('Database synchronized successfully.');
    })
    .catch((error) => {
        console.error('Error synchronizing the database:', error);
    });

module.exports = { DATABASE };

// PatronTechX