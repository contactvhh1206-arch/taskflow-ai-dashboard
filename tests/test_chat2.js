import { searchKnowledgeBase } from './server.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        console.log("Testing searchKnowledgeBase with targetFacility filtering...");
        const query = "tk của tôi có thể truy xuất doanh thu cơ sở nào";
        const perms = {
            role: "FINANCE_DEPT",
            facilityId: null, // As finance, this is what is passed
            isGlobal: false
        };
        const results = await searchKnowledgeBase(query, perms);
        console.log("Results:", results);
    } catch (err) {
        console.error("Crash during test:", err);
    }
}
test();
