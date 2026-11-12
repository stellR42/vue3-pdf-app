/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { AppOptions, OptionKind } from "./app_options.js";
class BasePreferences {
  #defaults = Object.freeze(AppOptions.getAll(OptionKind.PREFERENCE, true));
  #initializedPromise = null;
  constructor() {
    this.#initializedPromise = this._readFromStorage(this.#defaults).then(({
      browserPrefs,
      prefs
    }) => {
      if (AppOptions._checkDisablePreferences()) {
        return;
      }
      AppOptions.setAll({
        ...browserPrefs,
        ...prefs
      }, true);
    });
  }
  async _writeToStorage(prefObj) {
    throw new Error("Not implemented: _writeToStorage");
  }
  async _readFromStorage(prefObj) {
    throw new Error("Not implemented: _readFromStorage");
  }
  async reset() {
    await this.#initializedPromise;
    AppOptions.setAll(this.#defaults, true);
    await this._writeToStorage(this.#defaults);
  }
  async set(name, value) {
    await this.#initializedPromise;
    AppOptions.setAll({
      [name]: value
    }, true);
    await this._writeToStorage(AppOptions.getAll(OptionKind.PREFERENCE));
  }
  async get(name) {
    await this.#initializedPromise;
    return AppOptions.get(name);
  }
  get defaults() {
    return this.#defaults;
  }
  get initializedPromise() {
    return this.#initializedPromise;
  }
}
export { BasePreferences };