import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dateKey, monthCells, remainingSeconds} from './model.js';
test('calendar includes leap day and Monday-based offset', () => {
 const cells = monthCells(new Date(2024,1,15));
 assert.equal(cells.length,32); assert.deepEqual(cells.slice(0,3),[null,null,null]);
 assert.equal(cells[3],'2024-02-01'); assert.equal(cells.at(-1),'2024-02-29');
});
test('calendar handles year boundary without UTC conversion', () => {
 assert.equal(dateKey(new Date(2026,0,1)), '2026-01-01');
 assert.equal(monthCells(new Date(2025,11,1)).at(-1), '2025-12-31');
});
test('timer accounts for elapsed time, rounds up and stops at zero', () => {
 assert.equal(remainingSeconds(1500000,600000),900);
 assert.equal(remainingSeconds(1500000,1499500),1);
 assert.equal(remainingSeconds(1500000,1501000),0);
});
