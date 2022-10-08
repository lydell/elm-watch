module App1 exposing (main)

import AppHelpers
import Html
import Shared

main = Html.text (AppHelpers.text ++ Shared.text)
