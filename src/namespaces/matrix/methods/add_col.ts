// SPDX-License-Identifier: AGPL-3.0-only

import { PineMatrixObject } from '../PineMatrixObject';
import { Context } from '../../../Context.class';

import { Series } from '../../../Series';
import { PineArrayObject } from '../../array/PineArrayObject';

export function add_col(context: Context) {
    return (id: PineMatrixObject, column_index?: number, values?: any) => {
        // Named arguments (`m.add_col(array_id=a)`, `m.add_col(column=0, array_id=a)`) arrive as one plain
        // object in the last position; unpack it (otherwise the column was added EMPTY).
        const named = [values, column_index].find((x: any) => x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype);
        if (named) {
            if (named === column_index) column_index = undefined;
            column_index = column_index ?? (named as any).column;
            values = (named as any).array_id;
        }
        const rows = id.matrix.length;
        
        let colValues: any[] = [];
        if (values) {
            if (values instanceof PineArrayObject) {
                colValues = values.array;
            } else if (Array.isArray(values)) {
                colValues = values;
            } else {
                colValues = [values];
            }
        }

        if (rows === 0) {
            // Create rows based on colValues length
            for (let i = 0; i < colValues.length; i++) {
                let val = colValues[i];
                if (val instanceof Series) val = val.get(0);
                id.matrix.push([val]);
            }
            return;
        }

        const cols = id.matrix[0].length;
        const index = column_index !== undefined ? column_index : cols;

        for (let i = 0; i < rows; i++) {
            let val = i < colValues.length ? colValues[i] : NaN;
            if (val instanceof Series) val = val.get(0);
            id.matrix[i].splice(index, 0, val);
        }
    };
}

