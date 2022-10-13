module Main exposing (main)

import Answer
import Greeting
import Html

main = Html.text (Greeting.greeting ++ String.fromInt Answer.answer)
