module AppOther exposing (main)

import AppOtherHelpers
import Html
import Shared

main = Html.text (AppOtherHelpers.text ++ Shared.text)
