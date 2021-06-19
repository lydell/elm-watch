module Shared exposing (view)
import Html
import SharedHelpers
view = SharedHelpers.transform >> Html.text
