# Third-party notices

This extension includes functionality adapted from other open-source projects.

## openmultiplayer/vscode-pawn

The Pawn **folding-range** logic in `src/editing.ts` is adapted from
[openmultiplayer/vscode-pawn](https://github.com/openmultiplayer/vscode-pawn),
which is distributed under the MIT License:

```
MIT License

Copyright (c) 2019 Indian Ocean Roleplay

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> **Note on the formatter:** the upstream extension's formatter relied on the
> `astyle` WASM library, which was implicated in repeated extension-host crashes
> (openmultiplayer/vscode-pawn issues #7, #8, #13). This extension does **not**
> use `astyle`; its formatter is an independent, dependency-free
> re-implementation, so that crash class does not apply here.
